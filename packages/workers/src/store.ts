/**
 * `DurableObjectSessionStore` — the `SessionStore` of `@stwrd-auth/workers`: one
 * Durable Object (`StwrdSessionObject`) per local session, named after the
 * namespace (tenant/client) and the session id, like the PostgreSQL key
 * `(namespace, session_id)`, so two clients that share a binding never share
 * an object, and a login, a refresh and a back-channel notice for different
 * sessions never queue behind each other and the lease of one session is
 * decided in one place.
 *
 * Sessions are sealed here, in the Worker, with a `Keyring` (JWE `dir` +
 * `A256GCM`, as `@stwrd-auth/node/postgres` does): the object only ever holds the
 * envelope, never the key and never a token in the clear. The authenticated
 * payload carries the namespace (tenant/client), the session id and the
 * purpose, so an envelope copied to another namespace or another object is
 * rejected on read. Lease phase, fence and expiry live in plain columns inside
 * the object because the object decides on them and they hold no secret.
 *
 * A store that does not answer is an IdP that does not answer: every failure of
 * a call to the object is raised as `IdpUnavailable`, so every route and guard answers
 * 503 and none of them reads it as "no session" (a session lost to a
 * hiccup of the platform is not a session that ended).
 *
 * Back-channel logout goes through the same objects: `backChannelSink()` gives
 * the sink, built from this store so it cannot name other objects than the
 * store does (the notice's `sid` names the session's own object, which deletes
 * the session and THEN marks the `jti`, in one call: `StwrdSessionObject.logout`.
 * If the object does not answer, nothing was marked: the caller answers 503 and
 * the IdP retries — it retries a 5xx and never a 4xx, so a `jti` marked before
 * a failed deletion would turn the retry into a "replay" and leave the session
 * alive for good).
 */

import type { BackChannelSink } from "@stwrd-auth/core/backchannel";
import type { Keyring } from "@stwrd-auth/core/keyring";
import { IdpUnavailable } from "@stwrd-auth/core/oidc";
import {
  type RefreshClaim,
  type SessionStore,
  type StwrdSession,
  type Tokens,
  withoutCapabilities,
} from "@stwrd-auth/core/sessions";
import type { ObjectClaim, StwrdSessionObject } from "./sessionObject.js";

/** The prefix of every object name; the namespace and the session id follow it. */
export const SESSION_OBJECT_PREFIX = "stwrd-session:";

/** The name of the object that keeps one session: the namespace and the id as
 * a JSON pair, so no namespace/id split can be read as another (a `|` or a
 * `:` inside either cannot move the boundary). */
export function sessionObjectName(namespace: string, sessionId: string): string {
  return SESSION_OBJECT_PREFIX + JSON.stringify([namespace, sessionId]);
}

/** Where the `jti` of a notice that names no `sid` (only a `sub`) is kept:
 * there is no session of ours to end, and the notice must not replay. The
 * namespace follows it, and the name cannot collide with a session's (those
 * start with `stwrd-session:`). */
export const UNNAMED_NOTICE_OBJECT = "stwrd-backchannel:unnamed";

export interface DurableObjectSessionStoreOptions {
  /** Tenant/client this store serves; bound into every envelope. */
  namespace: string;
  keyring: Keyring;
  /** Called with the reason when an envelope cannot be read (tampered,
   * relocated, key gone). Default: `console.warn`. */
  onUnreadable?: (error: unknown) => void;
}

export type SessionObjects = DurableObjectNamespace<StwrdSessionObject>;

function defaultUnreadable(error: unknown): void {
  console.warn("stwrd: unreadable session envelope", error);
}

export class DurableObjectSessionStore implements SessionStore {
  constructor(
    private readonly objects: SessionObjects,
    private readonly options: DurableObjectSessionStoreOptions,
  ) {
    if (!options.namespace) throw new Error("A namespace (tenant/client) is required.");
  }

  private get namespace(): string {
    return this.options.namespace;
  }

  private objectFor(sessionId: string): DurableObjectStub<StwrdSessionObject> {
    return this.objects.get(this.objects.idFromName(sessionObjectName(this.namespace, sessionId)));
  }

  /** Every call to an object goes through here: whatever goes wrong, the store did not answer. */
  private async call<T>(sessionId: string, run: (stub: DurableObjectStub<StwrdSessionObject>) => PromiseLike<T>): Promise<T> {
    try {
      return await run(this.objectFor(sessionId));
    } catch (error) {
      throw Object.assign(new IdpUnavailable("The session store did not respond.", false), { cause: error });
    }
  }

  /** The back-channel logout sink for the objects of THIS store: same
   * namespace, same objects. There is no way to build one with another namespace. */
  backChannelSink(): BackChannelSink {
    return {
      terminate: async (sessionId, jti, untilS) => {
        const name = sessionId === null ? `${UNNAMED_NOTICE_OBJECT}:${this.namespace}` : sessionObjectName(this.namespace, sessionId);
        try {
          return await this.objects.get(this.objects.idFromName(name)).logout(jti, untilS);
        } catch (error) {
          throw Object.assign(new IdpUnavailable("The session store did not respond.", false), { cause: error });
        }
      },
    };
  }

  private async seal(session: StwrdSession): Promise<string> {
    return this.options.keyring.encrypt(JSON.stringify({ ns: this.namespace, sid: session.id, purpose: "session", session }));
  }

  private async open(sessionId: string, payload: string): Promise<StwrdSession | null> {
    try {
      const body = JSON.parse(await this.options.keyring.decrypt(payload));
      if (body.ns !== this.namespace || body.sid !== sessionId || body.purpose !== "session") {
        throw new Error("Envelope context does not match its location.");
      }
      return body.session as StwrdSession;
    } catch (error) {
      // Fail closed: a tampered, relocated or unreadable envelope is no session.
      (this.options.onUnreadable ?? defaultUnreadable)(error);
      return null;
    }
  }

  async get(sessionId: string): Promise<StwrdSession | null> {
    const payload = await this.call(sessionId, (stub) => stub.get());
    return payload === null ? null : this.open(sessionId, payload);
  }

  async set(session: StwrdSession): Promise<void> {
    const payload = await this.seal(session);
    await this.call(session.id, (stub) => stub.set(payload, session.expiresAt));
  }

  async delete(sessionId: string): Promise<void> {
    await this.call(sessionId, (stub) => stub.delete());
  }

  /** Two steps across two objects, not one: the old session is retired first
   * (and only if it still exists, so a logout in between is never undone) and
   * the new one installed second. A failure between them leaves no session —
   * the person signs in again — and never two. */
  async replaceSession(oldId: string, session: StwrdSession): Promise<boolean> {
    const retired = await this.call(oldId, (stub) => stub.retire());
    if (!retired) return false;
    await this.set(session);
    return true;
  }

  async claimRefresh(sessionId: string, owner: string, leaseS: number): Promise<RefreshClaim> {
    const claim = await this.call<ObjectClaim>(sessionId, (stub) => stub.claim(owner, leaseS));
    if (claim.status !== "granted") return { status: claim.status };
    const session = await this.open(sessionId, claim.payload);
    if (!session) {
      // A lease on an envelope nobody can read would only block the session.
      await this.call(sessionId, (stub) => stub.release(claim.fence, false));
      return { status: "gone" };
    }
    return { status: "granted", session, fence: claim.fence, phase: claim.phase, freshIdToken: claim.freshIdToken };
  }

  async markRefreshSent(sessionId: string, fence: number): Promise<boolean> {
    return this.call(sessionId, (stub) => stub.markSent(fence));
  }

  async checkpointRefresh(sessionId: string, fence: number, tokens: Tokens, freshIdToken: boolean): Promise<boolean> {
    // The object cannot rewrite what it cannot read: the envelope is opened
    // here, the rotated tokens put in, and the lease (fence and phase) decides
    // in the object whether this write still counts.
    const payload = await this.call(sessionId, (stub) => stub.get());
    const current = payload === null ? null : await this.open(sessionId, payload);
    if (!current) return false;
    const sealed = await this.seal({ ...current, claims: withoutCapabilities(current.claims), tokens });
    return this.call(sessionId, (stub) => stub.checkpoint(fence, sealed, freshIdToken));
  }

  async completeRefresh(sessionId: string, fence: number, session: StwrdSession): Promise<boolean> {
    if (session.id !== sessionId) return false;
    const payload = await this.seal(session);
    return this.call(sessionId, (stub) => stub.complete(fence, payload, session.expiresAt));
  }

  async releaseRefresh(sessionId: string, fence: number, sent: boolean): Promise<void> {
    await this.call(sessionId, (stub) => stub.release(fence, sent));
  }
}
