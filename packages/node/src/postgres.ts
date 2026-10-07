/**
 * A shared `SessionStore` on PostgreSQL, for deployments with several workers.
 *
 * Sessions are encrypted as JWE (`dir` + `A256GCM`, via jose) with a keyring
 * independent of the cookie secret. The authenticated payload also carries the
 * namespace (tenant/client), the session id and the purpose, so a row copied
 * to another namespace or id is rejected on read. Lease phase, fence and
 * expiry stay in plain columns because coordination needs them in SQL and they
 * hold no secret; lease expiry is judged by the database clock. The schema is
 * explicit: run `SCHEMA_SQL` from your own migration, the store never creates
 * tables. A namespace belongs to one SDK language: the payload shape is not
 * shared with the Python store.
 */

import { Keyring } from "@stwrd-auth/core/keyring";
import type { RefreshClaim, RefreshPhase, SessionStore, StwrdSession, Tokens } from "@stwrd-auth/core/sessions";
import { withoutCapabilities } from "@stwrd-auth/core/sessions";

export const SCHEMA_SQL = `
CREATE SEQUENCE stwrd_sdk_fence_seq;
CREATE TABLE stwrd_sdk_sessions (
    namespace text NOT NULL,
    session_id text NOT NULL,
    payload text NOT NULL,
    expires_at double precision NOT NULL,
    fence bigint NOT NULL DEFAULT nextval('stwrd_sdk_fence_seq'),
    lease_owner text,
    lease_phase text CHECK (lease_phase IN ('acquired', 'sent', 'hydrating', 'uncertain')),
    lease_expires_at timestamptz,
    fresh_id_token boolean NOT NULL DEFAULT false,
    PRIMARY KEY (namespace, session_id),
    CHECK ((lease_phase IS NULL) = (lease_owner IS NULL))
);
CREATE INDEX stwrd_sdk_sessions_expiry ON stwrd_sdk_sessions (namespace, expires_at);
`;

// `Keyring` lives in the core (the Durable Object store of `@stwrd-auth/workers` needs
// it too); this entry point keeps exporting it.
export { Keyring };

const TABLE = "stwrd_sdk_sessions";

/** The slice of `pg.Pool` the store uses, so `pg` stays optional. */
export interface PgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(error?: Error | boolean): void;
}
export interface PgPool {
  connect(): Promise<PgClient>;
}

function defaultUnreadable(error: unknown): void {
  console.warn("stwrd: unreadable session row", error);
}

export class PostgresSessionStore implements SessionStore {
  constructor(
    private readonly pool: PgPool,
    private readonly options: { namespace: string; keyring: Keyring; onUnreadable?: (error: unknown) => void },
  ) {
    if (!options.namespace) throw new Error("A namespace (tenant/client) is required.");
  }

  private get namespace(): string {
    return this.options.namespace;
  }

  private async seal(session: StwrdSession): Promise<string> {
    return this.options.keyring.encrypt(JSON.stringify({ ns: this.namespace, sid: session.id, purpose: "session", session }));
  }

  private async open(sessionId: string, payload: string): Promise<StwrdSession | null> {
    try {
      const body = JSON.parse(await this.options.keyring.decrypt(payload));
      if (body.ns !== this.namespace || body.sid !== sessionId || body.purpose !== "session") {
        throw new Error("Row context does not match its location.");
      }
      return body.session as StwrdSession;
    } catch (error) {
      // Fail closed: a tampered, relocated or unreadable row is no session.
      (this.options.onUnreadable ?? defaultUnreadable)(error);
      return null;
    }
  }

  private async withClient<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      return await run(client);
    } catch (error) {
      broken = (error as { brokenConnection?: boolean }).brokenConnection === true;
      throw error;
    } finally {
      // A connection whose ROLLBACK failed is destroyed, never reused.
      client.release(broken);
    }
  }

  private async transaction<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
    return this.withClient(async client => {
      await client.query("BEGIN");
      try {
        const result = await run(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          throw Object.assign(error as Error, { brokenConnection: true });
        }
        throw error;
      }
    });
  }

  async get(sessionId: string): Promise<StwrdSession | null> {
    const { rows } = await this.withClient(client =>
      client.query(`SELECT payload FROM ${TABLE} WHERE namespace = $1 AND session_id = $2`, [this.namespace, sessionId]));
    return rows.length ? this.open(sessionId, rows[0].payload as string) : null;
  }

  async set(session: StwrdSession): Promise<void> {
    const payload = await this.seal(session);
    await this.withClient(client => client.query(
      `INSERT INTO ${TABLE} (namespace, session_id, payload, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (namespace, session_id) DO UPDATE SET
         payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at,
         fence = nextval('stwrd_sdk_fence_seq'), lease_owner = NULL, lease_phase = NULL,
         lease_expires_at = NULL, fresh_id_token = false`,
      [this.namespace, session.id, payload, session.expiresAt]));
  }

  async delete(sessionId: string): Promise<void> {
    await this.withClient(client => client.query(`DELETE FROM ${TABLE} WHERE namespace = $1 AND session_id = $2`, [this.namespace, sessionId]));
  }

  /** Delete this namespace's sessions past their local expiry (and with them
   * their stored refresh tokens). Run it periodically. */
  async purgeExpired(): Promise<number> {
    const result = await this.withClient(client => client.query(
      `DELETE FROM ${TABLE} WHERE namespace = $1 AND expires_at < $2 RETURNING 1`, [this.namespace, Date.now() / 1000]));
    return result.rows.length;
  }

  async replaceSession(oldId: string, session: StwrdSession): Promise<boolean> {
    const payload = await this.seal(session);
    return this.transaction(async client => {
      const removed = await client.query(`DELETE FROM ${TABLE} WHERE namespace = $1 AND session_id = $2 RETURNING 1`, [this.namespace, oldId]);
      if (!removed.rows.length) return false;
      await client.query(
        `INSERT INTO ${TABLE} (namespace, session_id, payload, expires_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (namespace, session_id) DO UPDATE SET
           payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at,
           fence = nextval('stwrd_sdk_fence_seq'), lease_owner = NULL, lease_phase = NULL,
           lease_expires_at = NULL, fresh_id_token = false`,
        [this.namespace, session.id, payload, session.expiresAt]);
      return true;
    });
  }

  async claimRefresh(sessionId: string, owner: string, leaseS: number): Promise<RefreshClaim> {
    return this.transaction(async client => {
      const { rows } = await client.query(
        `SELECT payload, lease_phase, fresh_id_token,
                coalesce(lease_expires_at <= clock_timestamp(), false) AS expired
         FROM ${TABLE} WHERE namespace = $1 AND session_id = $2 FOR UPDATE`, [this.namespace, sessionId]);
      if (!rows.length) return { status: "gone" } as const;
      const row = rows[0];
      const session = await this.open(sessionId, row.payload as string);
      if (!session) return { status: "gone" } as const;
      const phase = row.lease_phase as RefreshPhase | null;
      if (phase === "uncertain") return { status: "uncertain" } as const;
      if (phase !== null && !row.expired) return { status: "busy" } as const;
      if (phase === "sent") {
        await client.query(`UPDATE ${TABLE} SET lease_phase = 'uncertain' WHERE namespace = $1 AND session_id = $2`, [this.namespace, sessionId]);
        return { status: "uncertain" } as const;
      }
      const granted = phase === "hydrating" ? "hydrating" : "acquired";
      const updated = await client.query(
        `UPDATE ${TABLE} SET fence = nextval('stwrd_sdk_fence_seq'), lease_owner = $1, lease_phase = $2,
           lease_expires_at = clock_timestamp() + make_interval(secs => $3)
         WHERE namespace = $4 AND session_id = $5 RETURNING fence`, [owner, granted, leaseS, this.namespace, sessionId]);
      return { status: "granted", session, fence: Number(updated.rows[0].fence), phase: granted, freshIdToken: Boolean(row.fresh_id_token) } as const;
    });
  }

  async markRefreshSent(sessionId: string, fence: number): Promise<boolean> {
    const { rows } = await this.withClient(client => client.query(
      `UPDATE ${TABLE} SET lease_phase = 'sent'
       WHERE namespace = $1 AND session_id = $2 AND fence = $3 AND lease_phase = 'acquired' RETURNING 1`,
      [this.namespace, sessionId, fence]));
    return rows.length > 0;
  }

  async checkpointRefresh(sessionId: string, fence: number, tokens: Tokens, freshIdToken: boolean): Promise<boolean> {
    return this.transaction(async client => {
      const { rows } = await client.query(
        `SELECT payload FROM ${TABLE} WHERE namespace = $1 AND session_id = $2 AND fence = $3 AND lease_phase = 'sent' FOR UPDATE`,
        [this.namespace, sessionId, fence]);
      const current = rows.length ? await this.open(sessionId, rows[0].payload as string) : null;
      if (!current) return false;
      const payload = await this.seal({ ...current, claims: withoutCapabilities(current.claims), tokens });
      await client.query(
        `UPDATE ${TABLE} SET payload = $1, lease_phase = 'hydrating', fresh_id_token = $2 WHERE namespace = $3 AND session_id = $4`,
        [payload, freshIdToken, this.namespace, sessionId]);
      return true;
    });
  }

  async completeRefresh(sessionId: string, fence: number, session: StwrdSession): Promise<boolean> {
    if (session.id !== sessionId) return false;
    const payload = await this.seal(session);
    const { rows } = await this.withClient(client => client.query(
      `UPDATE ${TABLE} SET payload = $1, expires_at = $2, lease_owner = NULL, lease_phase = NULL,
         lease_expires_at = NULL, fresh_id_token = false
       WHERE namespace = $3 AND session_id = $4 AND fence = $5
         AND lease_phase IS NOT NULL AND lease_phase <> 'uncertain' RETURNING 1`,
      [payload, session.expiresAt, this.namespace, sessionId, fence]));
    return rows.length > 0;
  }

  async releaseRefresh(sessionId: string, fence: number, sent: boolean): Promise<void> {
    await this.withClient(client => client.query(
      `UPDATE ${TABLE} SET
         lease_phase = CASE
           WHEN lease_phase = 'sent' AND $1::boolean THEN 'uncertain'
           WHEN lease_phase = 'hydrating' THEN 'hydrating'
           ELSE NULL END,
         lease_owner = CASE
           WHEN lease_phase = 'hydrating' OR (lease_phase = 'sent' AND $1::boolean) THEN lease_owner
           ELSE NULL END,
         lease_expires_at = CASE
           WHEN lease_phase = 'hydrating' THEN clock_timestamp()
           WHEN lease_phase = 'sent' AND $1::boolean THEN lease_expires_at
           ELSE NULL END
       WHERE namespace = $2 AND session_id = $3 AND fence = $4
         AND lease_phase IS NOT NULL AND lease_phase <> 'uncertain'`,
      [sent, this.namespace, sessionId, fence]));
  }
}
