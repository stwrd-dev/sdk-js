/** Session projections separate profile, organization and consent state.
 * Raw verified claims and OAuth tokens remain in the server-side store. */
export type Claims = Record<string, unknown>;

/** What the token endpoint handed back for one session, plus the one field
 * the SDK computes on receipt. `refresh_token` is `undefined` — never a
 * fabricated empty string — when the grant carried none (without the
 * `offline_access` scope a session cannot be renewed). */
export interface Tokens {
  access_token: string;
  id_token: string;
  token_type: string;
  refresh_token?: string;
  /** Epoch seconds; computed from `expires_in` on receipt — see
   * `accessExpiry`. Not a wire field: the response only ever carries the
   * relative `expires_in`. */
  expiresAt: number;
}

export type ConsentState = "accepted" | "declined" | "pending";
export interface StwrdUser {
  id: string;
  email: string | null;
  email_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  permissions: string[];
}
export interface StwrdOrganization {
  id: string;
  display_name: string;
  roles: string[];
  permissions: string[];
}
export interface SessionContext {
  user: StwrdUser | null;
  organization: StwrdOrganization | null;
  consents: Record<string, ConsentState>;
}
export interface SessionResponse extends SessionContext {
  authenticated: boolean;
  csrf_token: string | null;
  account_url: string;
}
const INDIVIDUAL = ["roles", "permissions"];
const ORGANIZATION = ["org_id", "org_display_name", "org_roles", "org_permissions"];
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(x => typeof x === "string");
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const nullable = (value: unknown): string | null => typeof value === "string" ? value : null;
export function contextFromClaims(claims: Claims): SessionContext {
  const individual = INDIVIDUAL.every(k => strings(claims[k])) && ORGANIZATION.every(k => !(k in claims));
  const organizational = nonempty(claims.org_id) && nonempty(claims.org_display_name)
    && strings(claims.org_roles) && strings(claims.org_permissions) && INDIVIDUAL.every(k => !(k in claims));
  const consents: Record<string, ConsentState> = {};
  if (claims.consents && typeof claims.consents === "object" && !Array.isArray(claims.consents)) {
    for (const [key, value] of Object.entries(claims.consents)) {
      if (value === "accepted" || value === "declined" || value === "pending") consents[key] = value;
    }
  }
  return {
    user: { id: String(claims.sub), email: nullable(claims.email), email_verified: claims.email_verified === true,
      display_name: nullable(claims.name), avatar_url: nullable(claims.picture),
      roles: individual ? [...claims.roles as string[]] : [], permissions: individual ? [...claims.permissions as string[]] : [] },
    organization: organizational ? { id: claims.org_id as string, display_name: claims.org_display_name as string,
      roles: [...claims.org_roles as string[]], permissions: [...claims.org_permissions as string[]] } : null,
    consents,
  };
}
export function userFromClaims(claims: Claims): StwrdUser { return contextFromClaims(claims).user!; }
export function sessionContext(session: StwrdSession | null): SessionContext {
  return session ? contextFromClaims(session.claims) : { user: null, organization: null, consents: {} };
}
export function sessionResponse(session: StwrdSession | null, accountUrl: string, csrf: string | null): SessionResponse {
  return { authenticated: session !== null, ...sessionContext(session), csrf_token: session ? csrf : null, account_url: accountUrl };
}
export function hasRole(context: SessionContext, role: string): boolean {
  return (context.organization ?? context.user)?.roles.includes(role) ?? false;
}
export function hasPermission(context: SessionContext, permission: string): boolean {
  return (context.organization ?? context.user)?.permissions.includes(permission) ?? false;
}
/** Merge only profile/consent data from subject-matched userinfo. */
export function mergeClaims(authority: Claims, userinfo: Claims, subject: string): Claims {
  if (!nonempty(subject) || userinfo.sub !== subject || (authority.sub !== undefined && authority.sub !== subject)) throw new Error("Subject mismatch.");
  const merged: Claims = { ...authority, sub: subject };
  delete merged.consents;
  for (const key of ["email", "email_verified", "name", "picture", "consents"]) {
    if (key in userinfo) merged[key] = userinfo[key];
  }
  return merged;
}
export function withoutCapabilities(claims: Claims): Claims {
  const result = { ...claims };
  for (const key of [...INDIVIDUAL, ...ORGANIZATION]) delete result[key];
  return result;
}

/** Epoch seconds when an access token expires, computed from a token
 * response's `expires_in` (defaulting to 3600 s the same way the callback
 * and the renewal both do). A free function and not something folded into
 * `Tokens` construction, so the two call sites that mint `Tokens` (the
 * callback and `renew`) share one place this arithmetic lives. */
export function accessExpiry(tokenResponse: { expires_in?: number }, now: number = Date.now() / 1000): number {
  return now + (tokenResponse.expires_in ?? 3600);
}

/** The BFF's local session row.
 *
 * `id` is this store's own opaque key (what the sealed cookie carries);
 * `sidIdp` is the IdP's `sid` claim, kept as its own field because
 * back-channel logout matches on it and must not depend on parsing `claims`
 * to find it. */
export interface StwrdSession {
  id: string;
  sidIdp: string | null;
  sub: string;
  claims: Claims;
  tokens: Tokens;
  /** Epoch seconds: the local, sliding `sessionTtlS` window. */
  expiresAt: number;
  /** Epoch seconds: when `tokens.access_token` expires. */
  accessExpiresAt: number;
}

export function sessionUser(session: StwrdSession): StwrdUser {
  return userFromClaims(session.claims);
}

export function isSessionExpired(session: StwrdSession, now: number = Date.now() / 1000): boolean {
  return now >= session.expiresAt;
}

export function isAccessTokenExpired(session: StwrdSession, now: number = Date.now() / 1000): boolean {
  return now >= session.accessExpiresAt;
}

export type RefreshPhase = "acquired" | "sent" | "hydrating" | "uncertain";

/** Answer to `SessionStore.claimRefresh`. `granted`: the caller owns the one
 * refresh of this session and passes `fence` to every later call; `phase` is
 * `acquired` (nothing sent) or `hydrating` (tokens already rotated and
 * checkpointed: only userinfo is left, never exchange again). `busy`: another
 * owner holds a live lease. `uncertain`: a request may have been processed
 * without its result stored; the refresh token is never used again. `gone`:
 * no such session. */
export type RefreshClaim =
  | { status: "granted"; session: StwrdSession; fence: number; phase: "acquired" | "hydrating"; freshIdToken: boolean }
  | { status: "busy" | "uncertain" | "gone" };

/**
 * Where sessions live. Refresh is coordinated through a durable lease with
 * fencing so one refresh token is exchanged at most once across processes:
 * `claimRefresh` hands the lease to one owner; `markRefreshSent` is written
 * BEFORE the exchange leaves; `checkpointRefresh` stores the rotated tokens
 * before any other network call (and drops authority claims until userinfo is
 * read again); `completeRefresh` stores the final session. Each of the last
 * three is a compare-and-set on `(sessionId, fence)` and returns false when
 * the lease was lost or the session deleted, so logout is never resurrected.
 * A lease that expires in phase `sent` becomes `uncertain`; in `hydrating` it
 * is resumed with userinfo only. `releaseRefresh({sent:false})` clears the
 * lease; `{sent:true}` in phase `sent` marks the session `uncertain`, in
 * `hydrating` keeps the checkpoint for a retry; on a session that is already
 * `uncertain` it does nothing, and so does `completeRefresh` (false).
 */
export interface SessionStore {
  get(sessionId: string): Promise<StwrdSession | null>;
  set(session: StwrdSession): Promise<void>;
  delete(sessionId: string): Promise<void>;
  /** Atomically install `session` and retire `oldId`, only if `oldId` still
   * exists. False (nothing written) when it was deleted meanwhile, so a logout
   * between the start of an organization switch and its callback is never
   * undone. */
  replaceSession(oldId: string, session: StwrdSession): Promise<boolean>;
  claimRefresh(sessionId: string, owner: string, leaseS: number): Promise<RefreshClaim>;
  markRefreshSent(sessionId: string, fence: number): Promise<boolean>;
  checkpointRefresh(sessionId: string, fence: number, tokens: Tokens, freshIdToken: boolean): Promise<boolean>;
  completeRefresh(sessionId: string, fence: number, session: StwrdSession): Promise<boolean>;
  releaseRefresh(sessionId: string, fence: number, sent: boolean): Promise<void>;
}

interface Lease {
  owner: string;
  fence: number;
  phase: RefreshPhase;
  expiresAt: number;
  freshIdToken: boolean;
}

/** The default `SessionStore`: an in-process `Map`. Fine for a single-process
 * demo or dev server; a deployment with more than one worker needs a shared
 * store implementing the same lease contract. */
export class MemoryStore implements SessionStore {
  private readonly sessions = new Map<string, StwrdSession>();
  private readonly leases = new Map<string, Lease>();
  private fence = 0;

  async get(sessionId: string): Promise<StwrdSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async set(session: StwrdSession): Promise<void> {
    this.sessions.set(session.id, session);
    this.leases.delete(session.id);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.leases.delete(sessionId);
  }

  async replaceSession(oldId: string, session: StwrdSession): Promise<boolean> {
    if (!this.sessions.has(oldId)) return false;
    await this.delete(oldId);
    await this.set(session);
    return true;
  }

  async claimRefresh(sessionId: string, owner: string, leaseS: number): Promise<RefreshClaim> {
    const session = this.sessions.get(sessionId);
    if (!session) return { status: "gone" };
    const now = Date.now() / 1000;
    const lease = this.leases.get(sessionId);
    if (lease) {
      if (lease.phase === "uncertain") return { status: "uncertain" };
      if (lease.expiresAt > now) return { status: "busy" };
      if (lease.phase === "sent") {
        lease.phase = "uncertain";
        return { status: "uncertain" };
      }
    }
    const phase = lease?.phase === "hydrating" ? "hydrating" : "acquired";
    const freshIdToken = lease?.freshIdToken ?? false;
    this.fence += 1;
    this.leases.set(sessionId, { owner, fence: this.fence, phase, expiresAt: now + leaseS, freshIdToken });
    return { status: "granted", session, fence: this.fence, phase, freshIdToken };
  }

  private held(sessionId: string, fence: number): Lease | null {
    const lease = this.leases.get(sessionId);
    return lease && lease.fence === fence && this.sessions.has(sessionId) ? lease : null;
  }

  async markRefreshSent(sessionId: string, fence: number): Promise<boolean> {
    const lease = this.held(sessionId, fence);
    if (!lease || lease.phase !== "acquired") return false;
    lease.phase = "sent";
    return true;
  }

  async checkpointRefresh(sessionId: string, fence: number, tokens: Tokens, freshIdToken: boolean): Promise<boolean> {
    const lease = this.held(sessionId, fence);
    if (!lease || lease.phase !== "sent") return false;
    const current = this.sessions.get(sessionId) as StwrdSession;
    this.sessions.set(sessionId, { ...current, claims: withoutCapabilities(current.claims), tokens });
    lease.phase = "hydrating";
    lease.freshIdToken = freshIdToken;
    return true;
  }

  async completeRefresh(sessionId: string, fence: number, session: StwrdSession): Promise<boolean> {
    const lease = this.held(sessionId, fence);
    if (!lease || lease.phase === "uncertain" || session.id !== sessionId) return false;
    this.sessions.set(sessionId, session);
    this.leases.delete(sessionId);
    return true;
  }

  async releaseRefresh(sessionId: string, fence: number, sent: boolean): Promise<void> {
    const lease = this.held(sessionId, fence);
    // An `uncertain` session stays so: the owner that sent the request is gone
    // and nothing it says now can reopen the consumed refresh token.
    if (!lease || lease.phase === "uncertain") return;
    if (lease.phase === "hydrating") lease.expiresAt = 0;
    else if (lease.phase === "sent" && sent) lease.phase = "uncertain";
    else this.leases.delete(sessionId);
  }
}
