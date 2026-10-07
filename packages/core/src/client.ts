/**
 * `StwrdCore` — the runtime-neutral object behind every JavaScript adapter:
 * configuration, OIDC client, session store, cookie sealing, session
 * resolution with the refresh lease, organization listing and webhook
 * verification. It knows nothing about Express, Node's `http` or a Worker's
 * `env`: `@stwrd-auth/node` extends it with the Express wiring. The Python SDK
 * implements the same session logic.
 */

import { randomBytes } from "node:crypto";

import {
  ConfigError,
  ENV_PREFIX,
  type EnvLike,
  type ResolvedConfig,
  type StwrdConfigOptions,
  configFromEnv,
  resolveConfig,
} from "./config.js";
import { csrfToken, sign, unsign } from "./crypto.js";
import { type FetchLike, IdpUnavailable, OidcClient, RefreshUncertain } from "./oidc.js";
import { type OwnOrganization, listOwnOrganizations } from "./organizations.js";
import {
  type Claims,
  type RefreshClaim,
  type SessionStore,
  type StwrdSession,
  type Tokens,
  MemoryStore,
  accessExpiry,
  mergeClaims,
  withoutCapabilities,
  isAccessTokenExpired,
  isSessionExpired,
} from "./sessions.js";
import { SeenEventIds, type WebhookEvent, verifyWebhook as verifyWebhookVector } from "./webhooks.js";

// Longer than the IdP request so a live exchange never loses its lease.
const REFRESH_LEASE_S = 30;

/** How long the IdP gets to answer the discovery probe (`probeBeforeExchange`). */
export const DISCOVERY_PROBE_TIMEOUT_MS = 5000;

/** How a runtime waits for, and checks the IdP before, a refresh. The defaults
 * suit Node; an adapter for a runtime where each store call is expensive (Workers: one Durable Object
 * call per poll) or where a failed exchange cannot be told apart from a lost
 * one passes its own. */
export interface RefreshTuning {
  /** Seconds a request waits for another owner's refresh of the same session
   * to finish, before answering "the IdP is unavailable". */
  waitS: number;
  /** Milliseconds to wait before polling the store again, given how many polls
   * (0 for the first) already found the lease busy. */
  pollDelayMs(attempt: number): number;
  /** Ask the IdP for its discovery document again, with a
   * `DISCOVERY_PROBE_TIMEOUT_MS` timeout, just BEFORE the exchange is marked as
   * sent. If the IdP does not answer, nothing was marked and nothing sent: the
   * lease is released and the next request tries again. Where a failure of the
   * exchange itself can never be proven "not sent" (the session would go
   * `uncertain`), this is what keeps an IdP that is down from costing a session. */
  probeBeforeExchange: boolean;
}

export const DEFAULT_REFRESH_TUNING: RefreshTuning = Object.freeze({
  waitS: 10,
  pollDelayMs: () => 50,
  probeBeforeExchange: false,
});

/** How a runtime keeps a renewal alive past the request that started it: given
 * the work (a promise that never rejects), it must not let the runtime cut it
 * short. On Workers this is `ctx.waitUntil`; where nothing cuts a request off
 * (Node) there is none, and a renewal runs inline. The caller still awaits the
 * renewal itself; this only stops "the person closed the tab" from killing it
 * between "marked sent" and "saved". */
export type KeepAlive = (work: Promise<void>) => void;

export interface StwrdOptions extends StwrdConfigOptions {
  sessions?: SessionStore;
  fetch?: FetchLike;
}

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export class StwrdCore {
  readonly config: ResolvedConfig;
  readonly oidc: OidcClient;
  readonly sessions: SessionStore;
  readonly seenWebhookIds: SeenEventIds;
  private readonly fetchImpl: FetchLike;
  private readonly tuning: RefreshTuning;

  constructor(options: StwrdOptions, tuning: RefreshTuning = DEFAULT_REFRESH_TUNING) {
    if (!Number.isFinite(tuning.waitS) || tuning.waitS <= 0 || typeof tuning.pollDelayMs !== "function") {
      throw new ConfigError("The refresh tuning needs a positive waitS and a pollDelayMs function.");
    }
    this.tuning = tuning;
    const { sessions, fetch: fetchImpl, ...configOptions } = options;
    this.config = resolveConfig(configOptions);
    this.sessions = sessions ?? new MemoryStore();
    this.fetchImpl = fetchImpl ?? defaultFetch;
    this.oidc = new OidcClient(this.fetchImpl, this.config.oidc());
    this.seenWebhookIds = new SeenEventIds();
  }

  // --- cookie sealing -------------------------------------------------

  /** HMAC-signed, base64url cookie value. Not encryption — nothing sealed
   * carries a secret the browser must not read; what this buys is
   * tamper-evidence, so a forged cookie unseals to nothing. */
  seal(value: unknown): string {
    const payloadB64 = Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
    return `${payloadB64}.${sign(this.config.cookieSecret, payloadB64)}`;
  }

  /** `null` on anything wrong — missing cookie, bad signature, bad JSON. */
  unseal(cookie: string | null | undefined): unknown {
    if (!cookie || !cookie.includes(".")) {
      return null;
    }
    const separator = cookie.lastIndexOf(".");
    const payloadB64 = cookie.slice(0, separator);
    const signature = cookie.slice(separator + 1);
    if (!signature || !unsign(this.config.cookieSecret, payloadB64, signature)) {
      return null;
    }
    try {
      return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    } catch {
      return null;
    }
  }

  csrf(sessionId: string): string {
    return csrfToken(this.config.cookieSecret, sessionId);
  }

  /** The local session id for an IdP session — derived, never random. It is
   * what lets back-channel logout reach a session with only the IdP's `sid`,
   * through `SessionStore.delete(id)` and no secondary index. */
  sessionIdForSid(sid: string): string {
    return sign(this.config.cookieSecret, `sid:${sid}`);
  }

  // --- organizations -----------------------------------------------------

  /** Organization selection needs the `org` scope to be requested
   * explicitly; it is never added automatically. */
  organizationSelectionEnabled(): boolean {
    return this.config.scope.split(/\s+/).includes("org");
  }

  /** The person's own usable organizations, read with their access token. */
  async listOrganizations(session: StwrdSession): Promise<OwnOrganization[]> {
    const discovery = await this.oidc.discover();
    return listOwnOrganizations(this.fetchImpl, this.config.issuer, discovery, session.tokens.access_token);
  }

  // --- sessions ----------------------------------------------------------

  /** The session ready to authorize with — renews the tokens if the session
   * holds a refresh token and the access token has expired. */
  async resolveSession(cookie: string | null | undefined, keepAlive?: KeepAlive): Promise<StwrdSession | null> {
    const payload = this.unseal(cookie);
    if (!payload || typeof payload !== "object" || !("sid" in (payload as Record<string, unknown>))) {
      return null;
    }
    const sid = String((payload as { sid: unknown }).sid);
    const session = await this.sessions.get(sid);
    if (!session) {
      return null;
    }
    if (isSessionExpired(session)) {
      await this.sessions.delete(session.id);
      return null;
    }
    if (isAccessTokenExpired(session)) {
      if (!session.tokens.refresh_token) {
        // Without `offline_access` there is no renewal: the credential's
        // lifetime is the access token's.
        await this.sessions.delete(session.id);
        return null;
      }
      // `renew` throws `IdpUnavailable` and it is NOT caught here on
      // purpose: that error is the difference between "no session" and
      // "cannot tell right now", and catching it would erase it.
      const renewed = await this.renew(session, keepAlive);
      if (!renewed) {
        await this.sessions.delete(session.id);
        return null;
      }
      return renewed;
    }
    return session;
  }

  /** Raw store read: unseals the cookie and looks the session up, with no
   * renewal and no expiry side effects. */
  async sessionFromCookie(cookie: string | null | undefined): Promise<StwrdSession | null> {
    const payload = this.unseal(cookie);
    if (!payload || typeof payload !== "object" || !("sid" in (payload as Record<string, unknown>))) {
      return null;
    }
    return this.sessions.get(String((payload as { sid: unknown }).sid));
  }

  /** Refresh `session` under the store's lease: across every worker the
   * refresh token is exchanged at most once. `null` when the IdP REJECTED the
   * renewal or the session was deleted meanwhile (`resolveSession` then ends
   * the local session). `IdpUnavailable` propagates when nothing can be
   * vouched for right now: the IdP is silent, another worker holds the lease
   * too long, or an earlier exchange may have rotated the token without its
   * result stored (`uncertain`: permanent for that session, the consumed token
   * is never replayed). With `keepAlive`, the owned renewal (marked sent →
   * exchange → saved) is handed to the runtime to finish even if the request
   * ends first. */
  private async renew(session: StwrdSession, keepAlive?: KeepAlive): Promise<StwrdSession | null> {
    const owner = randomBytes(16).toString("base64url");
    const deadline = Date.now() + this.tuning.waitS * 1000;
    let current = session;
    for (let attempt = 0; ; attempt += 1) {
      const claim = await this.sessions.claimRefresh(current.id, owner, REFRESH_LEASE_S);
      if (claim.status === "granted") {
        const work = this.renewOwned(claim);
        // From the lease on, the renewal has to reach its end even if the
        // request is gone: "marked sent" without "saved" is an `uncertain` session.
        keepAlive?.(work.then(() => undefined, () => undefined));
        return work;
      }
      if (claim.status === "gone") return null;
      if (claim.status === "uncertain") {
        throw new RefreshUncertain("A refresh may have been processed without its result; sign in again.");
      }
      if (Date.now() >= deadline) throw new IdpUnavailable("Another worker is still refreshing this session.");
      const delay = this.tuning.pollDelayMs(attempt);
      await new Promise(resolve => setTimeout(resolve, Number.isFinite(delay) && delay >= 0 ? delay : 50));
      const latest = await this.sessions.get(current.id);
      if (!latest || isSessionExpired(latest)) return null;
      if (!isAccessTokenExpired(latest)) return latest;
      current = latest;
    }
  }

  /** A lost lease is not a rejection: only a session that no longer exists
   * ends (logout). One that is still there, possibly re-created by a new
   * sign-in, must not be deleted by a stale owner. */
  private async leaseLost(sessionId: string): Promise<null> {
    if ((await this.sessions.get(sessionId)) === null) return null;
    throw new IdpUnavailable("The refresh lease was lost; try again.");
  }

  private async renewOwned(claim: Extract<RefreshClaim, { status: "granted" }>): Promise<StwrdSession | null> {
    const { session, fence } = claim;
    let tokens: Tokens;
    let freshIdToken: boolean;
    if (claim.phase === "acquired") {
      if (!isAccessTokenExpired(session)) {
        await this.sessions.releaseRefresh(session.id, fence, false);
        return session;
      }
      const refreshToken = session.tokens.refresh_token;
      if (!refreshToken) {
        await this.sessions.releaseRefresh(session.id, fence, false);
        return null;
      }
      try {
        // Discovery is read before anything is marked as sent: a failure here
        // proves nothing left for the token endpoint. With `probeBeforeExchange`
        // it is read AGAIN (not from the cache) and under a timeout: the IdP has
        // just answered, so a failure of the exchange that follows is not an IdP
        // that was down all along.
        await this.oidc.discover(
          this.tuning.probeBeforeExchange ? { force: true, timeoutMs: DISCOVERY_PROBE_TIMEOUT_MS } : undefined,
        );
      } catch (exc) {
        await this.sessions.releaseRefresh(session.id, fence, false);
        throw exc instanceof IdpUnavailable ? exc : new IdpUnavailable("The IdP discovery document is unusable.", false);
      }
      if (!(await this.sessions.markRefreshSent(session.id, fence))) {
        throw new IdpUnavailable("The refresh lease was lost; try again.");
      }
      let tokenResponse: Record<string, unknown>;
      try {
        tokenResponse = await this.oidc.exchangeRefreshToken(refreshToken);
      } catch (exc) {
        if (exc instanceof IdpUnavailable) {
          await this.sessions.releaseRefresh(session.id, fence, exc.requestSent);
          throw exc;
        }
        return null;
      }
      // An unusable 200 (missing access_token, non-numeric expires_in) is a
      // rejection, never a corrupt expiry stored.
      const expiresAt = accessExpiry(tokenResponse as { expires_in?: number });
      if (typeof tokenResponse.access_token !== "string" || !Number.isFinite(expiresAt)) return null;
      tokens = {
        access_token: tokenResponse.access_token,
        id_token: (tokenResponse.id_token as string | undefined) ?? session.tokens.id_token,
        token_type: (tokenResponse.token_type as string | undefined) ?? "Bearer",
        refresh_token: tokenResponse.refresh_token as string | undefined,
        expiresAt,
      };
      freshIdToken = Boolean(tokenResponse.id_token);
      // The old refresh token is consumed: store the rotation before any
      // other network call. A lost lease (logout, takeover) ends the session
      // instead of resurrecting it.
      if (!(await this.sessions.checkpointRefresh(session.id, fence, tokens, freshIdToken))) return this.leaseLost(session.id);
    } else {
      tokens = session.tokens;
      freshIdToken = claim.freshIdToken;
    }

    let userinfoClaims: Claims;
    let idClaims: Claims = {};
    try {
      if (freshIdToken) {
        // The nonce never travels in a refresh's id_token (`nonce: null`).
        idClaims = await this.oidc.validateIdToken(tokens.id_token, { nonce: null, accessToken: tokens.access_token });
        if (idClaims.sub !== session.sub) return null;
      }
      userinfoClaims = await this.oidc.userinfo(tokens.access_token);
    } catch (exc) {
      if (exc instanceof IdpUnavailable) {
        // Tokens are checkpointed: a later claim retries userinfo only.
        await this.sessions.releaseRefresh(session.id, fence, true);
        throw exc;
      }
      return null;
    }

    // New verified claims replace authority. A refresh without an ID token
    // preserves identity metadata, but cannot reuse prior capabilities.
    // Userinfo contributes only subject-matched profile and consents.
    const base = freshIdToken ? idClaims : withoutCapabilities(session.claims);
    let claims: Claims;
    try { claims = mergeClaims(base, userinfoClaims, session.sub); } catch { return null; }
    const renewed: StwrdSession = {
      id: session.id,
      sidIdp: (claims.sid as string | undefined) ?? session.sidIdp,
      sub: session.sub,
      claims,
      tokens,
      // The slide: a fresh `sessionTtlS` window from now.
      expiresAt: Date.now() / 1000 + this.config.sessionTtlS,
      accessExpiresAt: tokens.expiresAt,
    };
    return (await this.sessions.completeRefresh(session.id, fence, renewed)) ? renewed : this.leaseLost(session.id);
  }

  // --- webhooks -----------------------------------------------------

  /** Verifies a webhook delivery and deduplicates it against
   * `this.seenWebhookIds`. Throws `ConfigError` if no `webhookSecret` is
   * configured — the `/auth/webhook` route turns that into a 503. */
  verifyWebhook(body: string | Buffer, headers: Record<string, string>): WebhookEvent {
    if (!this.config.webhookSecret) {
      throw new ConfigError(
        "STWRD_WEBHOOK_SECRET is not configured: no webhook can be verified without a secret.",
      );
    }
    return verifyWebhookVector(body, headers, this.config.webhookSecret, { seen: this.seenWebhookIds });
  }
}

const ENV_NAME_BY_FIELD: Record<string, string> = {
  issuer: "ISSUER",
  clientId: "CLIENT_ID",
  clientSecret: "CLIENT_SECRET",
  baseUrl: "BASE_URL",
  cookieSecret: "COOKIE_SECRET",
};

/** Reads `STWRD_*` variables from `env`, with `overrides` winning over them,
 * and fails closed (`ConfigError`) when a required one is missing from both.
 * There is no default `env` here: `@stwrd-auth/node` passes `process.env`. */
export function stwrdOptionsFromEnv(env: EnvLike, overrides: Partial<StwrdOptions> = {}): StwrdOptions {
  const { sessions, fetch: fetchImpl, ...configOverrides } = overrides;
  const merged = { ...configFromEnv(env, ENV_PREFIX), ...configOverrides } as StwrdConfigOptions;
  const missing = (["issuer", "clientId", "clientSecret", "baseUrl", "cookieSecret"] as const).filter(
    (field) => !merged[field],
  );
  if (missing.length > 0) {
    throw new ConfigError(
      "Missing required environment variables: " +
        missing.map((field) => `${ENV_PREFIX}${ENV_NAME_BY_FIELD[field] ?? field}`).join(", "),
    );
  }
  return { ...merged, sessions, fetch: fetchImpl };
}
