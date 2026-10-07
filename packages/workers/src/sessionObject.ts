/**
 * `StwrdSessionObject` — the Durable Object that keeps ONE session (the object
 * is named after the namespace and the local session id) and runs its refresh lease.
 *
 * It never sees a session in the clear: the Worker seals the session (JWE, see
 * `store.ts`) and the object stores the envelope next to the lease columns,
 * which hold no secret. The lease is the same state machine as the PostgreSQL
 * and in-memory stores of `@stwrd-auth/node` (`SessionStore` in `@stwrd-auth/core/sessions`
 * is the contract): `claim` grants the one refresh of a session, and every later
 * step is a compare-and-set on the fence it handed out.
 *
 * **Every method is synchronous.** Awaiting a timer or a `fetch` inside a
 * method can let another call in between, so the invariants cannot depend on a method being atomic
 * across an `await`; with no `await` a method runs to the end before any other
 * call is delivered, and the multi-statement ones are one `transactionSync`.
 * Only `alarm` is async, at its very end. The lease clock is this object's.
 *
 * The object deletes itself: an alarm at the session's expiry removes the
 * envelope (and with it the stored refresh token) and, when nothing is left,
 * the whole storage. Storage is only ever created by a write (`set`, `logout`):
 * reads and lease calls on an object with nothing in it make nothing.
 */

import { DurableObject } from "cloudflare:workers";

/** What `claim` answers: `RefreshClaim` of the core, with the sealed envelope
 * in place of the session. */
export type ObjectClaim =
  | { status: "granted"; payload: string; fence: number; phase: "acquired" | "hydrating"; freshIdToken: boolean }
  | { status: "busy" | "uncertain" | "gone" };

type Row = Record<string, SqlStorageValue>;

export class StwrdSessionObject extends DurableObject {
  private ready = false;

  /** Whether the storage exists. Only a write creates it (`ensureSchema`), so
   * a read of an object nobody ever signed in under, or of one whose alarm
   * emptied it, finds nothing and makes nothing. */
  private hasSchema(): boolean {
    if (this.ready) return true;
    const [row] = this.rows("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'counter', 'seen')");
    this.ready = row?.n === 3;
    return this.ready;
  }

  // The storage is created by the first write (and again after the alarm emptied it).
  private ensureSchema(): void {
    if (this.ready) return;
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS session (
      slot INTEGER PRIMARY KEY CHECK (slot = 0),
      payload TEXT NOT NULL,
      expires_at REAL NOT NULL,
      fence INTEGER NOT NULL,
      lease_owner TEXT,
      lease_phase TEXT CHECK (lease_phase IN ('acquired', 'sent', 'hydrating', 'uncertain')),
      lease_expires_at REAL,
      fresh_id_token INTEGER NOT NULL DEFAULT 0,
      CHECK ((lease_phase IS NULL) = (lease_owner IS NULL))
    )`);
    sql.exec("CREATE TABLE IF NOT EXISTS counter (slot INTEGER PRIMARY KEY CHECK (slot = 0), fence INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS seen (jti TEXT PRIMARY KEY, until_s REAL NOT NULL)");
    this.ready = true;
  }

  private rows(query: string, ...bindings: SqlStorageValue[]): Row[] {
    return this.ctx.storage.sql.exec(query, ...bindings).toArray() as Row[];
  }

  private nowS(): number {
    return Date.now() / 1000;
  }

  /** Strictly increasing, survives `delete`, and anchored to the clock so it
   * still exceeds every earlier fence after the storage was emptied. */
  private nextFence(): number {
    const [row] = this.rows("SELECT fence FROM counter WHERE slot = 0");
    const next = Math.max(((row?.fence as number | undefined) ?? 0) + 1, Date.now() * 1000);
    this.rows("INSERT INTO counter (slot, fence) VALUES (0, ?) ON CONFLICT (slot) DO UPDATE SET fence = excluded.fence", next);
    return next;
  }

  /** The alarm goes off at the earliest thing this object has to forget. */
  private scheduleAlarm(): void {
    const [row] = this.rows(
      `SELECT min(t) AS next_at FROM (SELECT expires_at AS t FROM session UNION ALL SELECT until_s AS t FROM seen)`,
    );
    if (row?.next_at !== null && row?.next_at !== undefined) {
      void this.ctx.storage.setAlarm(Math.ceil((row.next_at as number) * 1000));
    }
  }

  // --- the session -------------------------------------------------------

  /** The sealed envelope, or `null`. Expiry is the caller's judgement (the
   * alarm removes the row some time after it). */
  get(): string | null {
    if (!this.hasSchema()) return null;
    const [row] = this.rows("SELECT payload FROM session WHERE slot = 0");
    return row ? (row.payload as string) : null;
  }

  /** Installs a session, clearing any lease and taking a new fence: a stale
   * owner of an earlier session under this id can no longer write. */
  set(payload: string, expiresAt: number): void {
    this.ensureSchema();
    this.ctx.storage.transactionSync(() => {
      const fence = this.nextFence();
      this.rows(
        `INSERT INTO session (slot, payload, expires_at, fence) VALUES (0, ?, ?, ?)
         ON CONFLICT (slot) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at,
           fence = excluded.fence, lease_owner = NULL, lease_phase = NULL, lease_expires_at = NULL, fresh_id_token = 0`,
        payload,
        expiresAt,
        fence,
      );
    });
    this.scheduleAlarm();
  }

  delete(): void {
    if (!this.hasSchema()) return;
    this.rows("DELETE FROM session");
    this.scheduleAlarm();
  }

  /** Deletes the session only if it is there; says whether it was. The first
   * step of an organization switch between two objects. */
  retire(): boolean {
    if (!this.hasSchema()) return false;
    const removed = this.rows("DELETE FROM session RETURNING slot").length > 0;
    this.scheduleAlarm();
    return removed;
  }

  // --- the refresh lease -------------------------------------------------

  /** Same decision table as the other stores: `gone` with no session; `uncertain`
   * for good once a sent request has no result; `busy` while another owner's
   * lease is live; an expired lease in `sent` becomes `uncertain`; otherwise
   * the caller is granted the lease (`hydrating` is resumed, anything else
   * starts at `acquired`). */
  claim(owner: string, leaseS: number): ObjectClaim {
    if (!this.hasSchema()) return { status: "gone" };
    return this.ctx.storage.transactionSync((): ObjectClaim => {
      const [row] = this.rows("SELECT payload, lease_phase, lease_expires_at, fresh_id_token FROM session WHERE slot = 0");
      if (!row) return { status: "gone" };
      const now = this.nowS();
      const phase = row.lease_phase as string | null;
      if (phase === "uncertain") return { status: "uncertain" };
      if (phase !== null && (row.lease_expires_at as number) > now) return { status: "busy" };
      if (phase === "sent") {
        this.rows("UPDATE session SET lease_phase = 'uncertain' WHERE slot = 0");
        return { status: "uncertain" };
      }
      const granted = phase === "hydrating" ? "hydrating" : "acquired";
      const fence = this.nextFence();
      this.rows(
        "UPDATE session SET fence = ?, lease_owner = ?, lease_phase = ?, lease_expires_at = ? WHERE slot = 0",
        fence,
        owner,
        granted,
        now + leaseS,
      );
      return { status: "granted", payload: row.payload as string, fence, phase: granted, freshIdToken: Boolean(row.fresh_id_token) };
    });
  }

  /** Written BEFORE the exchange leaves: from this point a lost answer is `uncertain`. */
  markSent(fence: number): boolean {
    if (!this.hasSchema()) return false;
    return this.rows("UPDATE session SET lease_phase = 'sent' WHERE fence = ? AND lease_phase = 'acquired' RETURNING slot", fence).length > 0;
  }

  /** Stores the rotated tokens (the caller re-sealed the envelope) and moves to `hydrating`. */
  checkpoint(fence: number, payload: string, freshIdToken: boolean): boolean {
    if (!this.hasSchema()) return false;
    return (
      this.rows(
        "UPDATE session SET payload = ?, lease_phase = 'hydrating', fresh_id_token = ? WHERE fence = ? AND lease_phase = 'sent' RETURNING slot",
        payload,
        freshIdToken ? 1 : 0,
        fence,
      ).length > 0
    );
  }

  /** Stores the final session and ends the lease. */
  complete(fence: number, payload: string, expiresAt: number): boolean {
    if (!this.hasSchema()) return false;
    const done =
      this.rows(
        `UPDATE session SET payload = ?, expires_at = ?, lease_owner = NULL, lease_phase = NULL, lease_expires_at = NULL,
           fresh_id_token = 0
         WHERE fence = ? AND lease_phase IS NOT NULL AND lease_phase <> 'uncertain' RETURNING slot`,
        payload,
        expiresAt,
        fence,
      ).length > 0;
    if (done) this.scheduleAlarm();
    return done;
  }

  /** `sent: false` clears the lease; `sent: true` in phase `sent` marks the
   * session `uncertain`, in `hydrating` keeps the checkpoint for a retry. A
   * session that is already `uncertain` stays so: the owner that sent the
   * request is gone and nothing it says now can clear that. */
  release(fence: number, sent: boolean): void {
    if (!this.hasSchema()) return;
    this.rows(
      `UPDATE session SET
         lease_phase = CASE
           WHEN lease_phase = 'sent' AND ? THEN 'uncertain'
           WHEN lease_phase = 'hydrating' THEN 'hydrating'
           ELSE NULL END,
         lease_owner = CASE
           WHEN lease_phase = 'hydrating' OR (lease_phase = 'sent' AND ?) THEN lease_owner
           ELSE NULL END,
         lease_expires_at = CASE
           WHEN lease_phase = 'hydrating' THEN ?
           WHEN lease_phase = 'sent' AND ? THEN lease_expires_at
           ELSE NULL END
       WHERE fence = ? AND lease_phase IS NOT NULL AND lease_phase <> 'uncertain'`,
      sent ? 1 : 0,
      sent ? 1 : 0,
      this.nowS(),
      sent ? 1 : 0,
      fence,
    );
  }

  // --- back-channel logout ---------------------------------------------------

  /** Ends the session and remembers the notice's `jti` until `untilS`, in one
   * step and in this order: the session is deleted FIRST and the `jti` marked
   * SECOND (`@stwrd-auth/core/backchannel`: the IdP retries a 5xx, and a `jti` marked
   * before a failed deletion would turn the retry into a "replay"). A `jti`
   * already seen deletes nothing. */
  logout(jti: string, untilS: number): "terminated" | "replay" {
    this.ensureSchema();
    const outcome = this.ctx.storage.transactionSync((): "terminated" | "replay" => {
      this.rows("DELETE FROM seen WHERE until_s <= ?", this.nowS());
      if (this.rows("SELECT 1 AS seen FROM seen WHERE jti = ?", jti).length > 0) return "replay";
      this.rows("DELETE FROM session");
      this.rows("INSERT INTO seen (jti, until_s) VALUES (?, ?)", jti, untilS);
      return "terminated";
    });
    this.scheduleAlarm();
    return outcome;
  }

  // --- forgetting ---------------------------------------------------------

  async alarm(): Promise<void> {
    if (!this.hasSchema()) return;
    const now = this.nowS();
    const left = this.ctx.storage.transactionSync(() => {
      this.rows("DELETE FROM session WHERE expires_at <= ?", now);
      this.rows("DELETE FROM seen WHERE until_s <= ?", now);
      return (this.rows("SELECT (SELECT count(*) FROM session) + (SELECT count(*) FROM seen) AS n")[0].n as number) ?? 0;
    });
    if (left === 0) {
      // Nothing left to remember: the storage goes too. The fence restarts from
      // the clock, which is above every fence handed out before.
      await this.ctx.storage.deleteAll();
      this.ready = false;
    } else {
      this.scheduleAlarm();
    }
  }
}
