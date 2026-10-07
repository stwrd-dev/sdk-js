/**
 * The relying-party OIDC client the BFF profile needs, and nothing more.
 * The Python SDK implements the same behavior.
 *
 * Signature verification goes through `jose`; protocol and cryptographic
 * primitives are not reimplemented. This module only adds the bookkeeping on
 * the relying-party side that the library does not do: PKCE, `state`/`nonce`,
 * the discovery and JWKS caches, and the claim checks (`iss`, `aud`,
 * `exp`/`iat`, `nonce`, `at_hash`).
 *
 * The injected `FetchLike` is a plain HTTP client; `Stwrd` defaults to
 * `globalThis.fetch`, so nothing needs wiring for the common case.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import * as jose from "jose";

import type { OidcParams } from "./config.js";

// --- JWKS cache bounds --------------------------------------------------------
// The TTL comes from the issuer's `Cache-Control`, clamped: a floor because
// `max-age=0` would turn every validation into a network round trip (an
// amplifier against the issuer, and a relying party that falls over when the
// IdP blips); a ceiling because past the longest access token's lifetime the
// cache buys nothing.
export const JWKS_TTL_FLOOR_S = 10;
export const JWKS_TTL_CEILING_S = 3600;
export const JWKS_DEFAULT_TTL_S = 300; // no `Cache-Control`, or unreadable.

// On seeing a `kid` it does not know, the JWKS is refetched at once, at most
// once per 10 s, so a token with an invented `kid` cannot be used as an
// amplifier against the issuer.
export const JWKS_UNKNOWN_KID_REFETCH_FLOOR_S = 10;

// The only algorithms accepted when verifying a signature. The list is fixed
// and never taken from the unverified header of the token itself: reading
// `alg` from there and passing it to `jose.jwtVerify` would let whoever signs
// the attack choose the algorithm (`alg: none` or another algorithm
// confusion). `jose` never implemented `none`, so this is not exploitable
// today, but the contract stays the same: `alg` is not the attacker's.
export const SUPPORTED_ALGS = ["RS256", "EdDSA"] as const;

const MAX_AGE_RE = /max-age=(\d+)/;

// The `events` member every `logout_token` must carry.
export const LOGOUT_EVENT_URI = "http://schemas.openid.net/event/backchannel-logout";

/** The exchange itself is rejected: bad `state`, a code that will not be
 * redeemed, an `id_token` that fails any of its checks.
 *
 * **The IdP ANSWERED, and the answer was no.** Its sibling below is the case
 * where it did not answer at all, and the difference is the whole point of
 * having two classes. */
export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcError";
  }
}

/** Per-request timeout of the refresh exchange; the store lease is longer. */
export const REFRESH_REQUEST_TIMEOUT_MS = 10_000;
/** The 4xx statuses that are not a rejection of the grant but a "not now":
 * 408, 425 and 429. */
export const RETRY_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

/** Network error codes that prove a request never reached the IdP. */
const PRE_SEND_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

function neverSent(exc: unknown): boolean {
  const cause = (exc as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" && PRE_SEND_CODES.has(cause.code);
}

/** The IdP could not answer: the fetch threw, or it came back 5xx.
 *
 * **Not a rejection, and that is the entire distinction.** A rejected grant is
 * the IdP exercising its authority: it looked at the credential and said no,
 * and the only correct move is to end the local session. Silence is not an
 * answer. Treating it as one would turn every blip of the IdP (a restart, a
 * node rotating, a second of packet loss) into a logout of everybody who
 * happened to be renewing: a self-inflicted outage that buys nothing, since an
 * attacker who can make the IdP unreachable gains only the logout.
 *
 * A 5xx counts as silence: an IdP under load answering `502` through the edge
 * is not saying "this grant is bad". Three 4xx codes count too
 * (`RETRY_STATUSES`): RFC 6749 §5.2 lists grant rejections under 400 and does
 * not promote every 4xx. A `429` from the token endpoint means "not now",
 * not "this credential is bad"; treating it as a rejection would log out
 * everyone who was renewing when a large relying party crossed the per-client
 * ceiling.
 *
 * This must never justify serving stale claims. The caller answers 503 and
 * keeps the session, so the next request renews and nobody notices.
 *
 * `requestSent` says whether the IdP may have processed the request: false
 * only when it provably never left (connection-phase failure) or the IdP said
 * "not now" (503, `RETRY_STATUSES`). A refresh whose request may have been
 * processed is never replayed: the token may already be rotated. An injected
 * `fetch` whose errors carry no `cause.code` is treated as "may have been
 * sent". */
export class IdpUnavailable extends Error {
  constructor(message: string, readonly requestSent: boolean = true) {
    super(message);
    this.name = "IdpUnavailable";
  }
}

/** An earlier refresh may have been processed without its result stored: the
 * consumed refresh token is never replayed. The session yields no authority
 * (503) but a new sign-in is allowed and replaces it. */
export class RefreshUncertain extends IdpUnavailable {
  constructor(message: string) {
    super(message);
    this.name = "RefreshUncertain";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Awaitable<T> = T | Promise<T>;

function clampTtl(cacheControl: string | null): number {
  if (!cacheControl) {
    return JWKS_DEFAULT_TTL_S;
  }
  const match = MAX_AGE_RE.exec(cacheControl.toLowerCase());
  if (!match) {
    return JWKS_DEFAULT_TTL_S;
  }
  const seconds = Number.parseInt(match[1] as string, 10);
  return Math.max(JWKS_TTL_FLOOR_S, Math.min(seconds, JWKS_TTL_CEILING_S));
}

// Exported only so the clamp table can be tested.
export const _clampTtl = clampTtl;

function b64url(raw: Buffer): string {
  return raw.toString("base64url");
}

// --- PKCE + state/nonce --------------------------------------------------------

const VERIFIER_BYTES = 32; // 43 base64url chars once encoded, inside RFC 7636's 43-128.

export function generateVerifier(): string {
  return b64url(randomBytes(VERIFIER_BYTES));
}

export function challengeS256(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function newState(): string {
  return b64url(randomBytes(24));
}

export function newNonce(): string {
  return b64url(randomBytes(24));
}

/** `at_hash`: half of the digest of `token`, base64url with no padding. The
 * digest is SHA-256 for RS256 and SHA-512 for EdDSA: it tracks the `id_token`'s
 * signing algorithm, not a fixed choice. */
export function halfHash(token: string, alg: string): string {
  const digest = createHash(alg === "RS256" ? "sha256" : "sha512")
    .update(token, "ascii")
    .digest();
  return b64url(digest.subarray(0, Math.floor(digest.length / 2)));
}

// --- discovery -----------------------------------------------------------------

export interface Discovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  jwksUri: string;
  endSessionEndpoint: string | null;
  revocationEndpoint: string | null;
  /** The raw discovery document, for consumers that validate extra metadata
   * (the Management destination) with their own rules. */
  document: Record<string, unknown>;
}

interface JwksEntry {
  raw: { keys: Array<Record<string, unknown>> };
  keySet: ReturnType<typeof jose.createLocalJWKSet>;
  fetchedAt: number;
  ttlS: number;
}

function keysetHasKid(raw: { keys: Array<Record<string, unknown>> }, kid: string): boolean {
  return raw.keys.some((key) => key.kid === kid);
}

/** One tenant's worth of OIDC plumbing, over an injected `FetchLike`. */
export class OidcClient {
  readonly params: OidcParams;
  private readonly fetchImpl: FetchLike;
  private discoveryDoc: Discovery | null = null;
  private jwks: JwksEntry | null = null;
  private jwksLastRefetch = 0;

  constructor(fetchImpl: FetchLike, params: OidcParams) {
    this.fetchImpl = fetchImpl;
    this.params = params;
  }

  // -- discovery --------------------------------------------------------

  /** Every call to the IdP goes through here, so the split between "did not
   * answer" and "answered no" is written ONCE. Five copies of this
   * `try` would be five chances to forget one, and the one forgotten is the
   * one that logs everybody out the day the IdP restarts. Returns the
   * response for the caller to judge; throws `IdpUnavailable` when there is
   * nothing to judge.
   *
   * A redirect is never followed: a 307/308 would re-send the whole body
   * (`client_secret`, refresh token, `code_verifier`) to wherever it points.
   * It is an answer that is not a 200, like any other, for the caller to
   * refuse (the Python SDK does not follow redirects either). "manual", not
   * "error": workerd's `fetch` throws on "error" for every request. */
  private async ask(url: string, what: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, redirect: "manual" });
    } catch (exc) {
      throw new IdpUnavailable(`${what}: the IdP did not respond (${(exc as Error).message}).`, !neverSent(exc));
    }
    if (response.status >= 500 || RETRY_STATUSES.has(response.status)) {
      throw new IdpUnavailable(
        `${what}: the IdP responded ${response.status}.`,
        !(response.status === 503 || RETRY_STATUSES.has(response.status)),
      );
    }
    if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      // With `manual` the 3xx arrives with its body and the connection stays
      // held until it is read or cancelled.
      await response.body?.cancel().catch(() => {});
      if (response.redirected || response.type === "opaqueredirect") {
        // A runtime that followed it anyway: whatever it answers is not the IdP's.
        throw new OidcError(`${what}: the IdP redirected and redirects are refused.`);
      }
    }
    return response;
  }

  /** The discovery document, from the cache unless `force`. `timeoutMs` bounds
   * the whole read (request and body): when it runs out the fetch is aborted and
   * the IdP counts as silent (`IdpUnavailable`). */
  async discover(options: { force?: boolean; timeoutMs?: number } = {}): Promise<Discovery> {
    if (this.discoveryDoc && !options.force) {
      return this.discoveryDoc;
    }
    if (options.timeoutMs === undefined) {
      return this.fetchDiscovery();
    }
    // `AbortController` + `setTimeout` and not `AbortSignal.timeout`: the timer
    // is the one a test (or a runtime) can drive, and it is cleared as soon as
    // the document is in.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      return await this.fetchDiscovery(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchDiscovery(signal?: AbortSignal): Promise<Discovery> {
    const url = `${this.params.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const response = await this.ask(url, "Discovery", signal ? { signal } : undefined);
    if (response.status !== 200) {
      throw new OidcError(`Discovery at ${this.params.issuer} responded ${response.status}.`);
    }
    let doc: Record<string, unknown>;
    try {
      doc = (await response.json()) as Record<string, unknown>;
    } catch (exc) {
      if (signal?.aborted) {
        throw new IdpUnavailable("Discovery: the IdP did not respond in time.", false);
      }
      throw exc;
    }
    for (const required of ["issuer", "authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"]) {
      if (!(required in doc)) {
        throw new OidcError(`The discovery document does not include ${required}.`);
      }
    }
    this.discoveryDoc = {
      issuer: doc.issuer as string,
      authorizationEndpoint: doc.authorization_endpoint as string,
      tokenEndpoint: doc.token_endpoint as string,
      userinfoEndpoint: doc.userinfo_endpoint as string,
      jwksUri: doc.jwks_uri as string,
      endSessionEndpoint: (doc.end_session_endpoint as string | undefined) ?? null,
      revocationEndpoint: (doc.revocation_endpoint as string | undefined) ?? null,
      document: doc,
    };
    return this.discoveryDoc;
  }

  /** Whether the discovery document advertises `end_session_endpoint`. When
   * it does not, sign-out degrades to a local-only logout; reading discovery
   * (rather than a configuration flag) keeps that decision in the IdP's hands. */
  async supportsEndSession(): Promise<boolean> {
    const discovery = await this.discover();
    return discovery.endSessionEndpoint !== null;
  }

  // -- JWKS, cached by the issuer's Cache-Control ------------------------

  private async fetchJwks(): Promise<JwksEntry> {
    const discovery = await this.discover();
    const response = await this.ask(discovery.jwksUri, "JWKS");
    if (response.status !== 200) {
      throw new OidcError(`The JWKS responded ${response.status}.`);
    }
    const ttlS = clampTtl(response.headers.get("cache-control"));
    const raw = (await response.json()) as { keys: Array<Record<string, unknown>> };
    const entry: JwksEntry = {
      raw,
      keySet: jose.createLocalJWKSet(raw as unknown as { keys: jose.JWK[] }),
      fetchedAt: Date.now() / 1000,
      ttlS,
    };
    this.jwks = entry;
    this.jwksLastRefetch = entry.fetchedAt;
    return entry;
  }

  /** Exposed so a caller can force a refetch outside the TTL/kid logic
   * (used by tests). */
  async _fetchJwks(): Promise<JwksEntry> {
    return this.fetchJwks();
  }

  /** Exposed so tests can pin "unknown kid → immediate refetch". */
  async _keysetFor(kid: string): Promise<JwksEntry> {
    return this.keysetFor(kid);
  }

  private async keysetFor(kid: string): Promise<JwksEntry> {
    let entry = this.jwks;
    const now = Date.now() / 1000;
    if (!entry || now - entry.fetchedAt >= entry.ttlS) {
      entry = await this.fetchJwks();
    }
    if (!keysetHasKid(entry.raw, kid)) {
      if (now - this.jwksLastRefetch >= JWKS_UNKNOWN_KID_REFETCH_FLOOR_S) {
        entry = await this.fetchJwks();
      }
    }
    return entry;
  }

  /** The cached JWKS entry; exposed so tests can inspect the cache. */
  get _jwks(): JwksEntry | null {
    return this.jwks;
  }

  // -- PKCE + authorize URL ----------------------------------------------

  async authorizeUrl(options: {
    state: string;
    nonce: string;
    codeChallenge: string;
    organizationId?: string | null;
  }): Promise<string> {
    const discovery = await this.discover();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: this.params.clientId,
      redirect_uri: this.params.redirectUri,
      scope: this.params.scope,
      state: options.state,
      nonce: options.nonce,
      code_challenge: options.codeChallenge,
      code_challenge_method: "S256",
    });
    if (options.organizationId) {
      query.set("organization_id", options.organizationId);
    }
    return `${discovery.authorizationEndpoint}?${query.toString()}`;
  }

  // -- code exchange -------------------------------------------------------

  async exchangeCode(options: { code: string; codeVerifier: string }): Promise<Record<string, unknown>> {
    const discovery = await this.discover();
    const response = await this.ask(discovery.tokenEndpoint, "Code exchange", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: options.code,
        redirect_uri: this.params.redirectUri,
        client_id: this.params.clientId,
        client_secret: this.params.clientSecret,
        code_verifier: options.codeVerifier,
      }),
    });
    if (response.status !== 200) {
      throw new OidcError(`The code exchange failed with ${response.status}.`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  // -- refresh ---------------------------------------------------------

  /** Used by `Stwrd.resolveSession` when the access token has expired and the
   * session holds a `refresh_token`.
   *
   * **Two errors, and which one comes out decides whether anybody is logged
   * out.** `OidcError` is a rejection the IdP issued (a revoked refresh token,
   * a reused one, a dead family), and the caller's move is to end the local
   * session. `IdpUnavailable` is no answer at all (the fetch threw, or a 5xx),
   * and the caller's move is to keep the session and fail the request: the
   * IdP never said this credential was bad. */
  async exchangeRefreshToken(refreshToken: string): Promise<Record<string, unknown>> {
    const discovery = await this.discover();
    const response = await this.ask(discovery.tokenEndpoint, "Refresh token renewal", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.params.clientId,
        client_secret: this.params.clientSecret,
      }),
      // Shorter than the store lease, so a hung IdP cannot outlive it.
      signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      throw new OidcError(`The refresh_token renewal failed with ${response.status}.`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  // -- id_token validation ---------------------------------------------

  /** Signature, `iss`, `aud`, `exp`/`iat`, `nonce`, `at_hash`. Any rejection
   * is `OidcError`. `nonce=null` is the refresh case, where the `id_token`
   * carries no nonce: the same equality check runs, not a relaxed one, so a
   * real nonce there still fails. */
  async validateIdToken(
    idToken: string,
    options: { nonce: string | null; accessToken: string },
  ): Promise<Record<string, unknown>> {
    const { claims, alg } = await this.verifyJws(idToken, "id_token");
    const discovery = await this.discover();
    if (claims.iss !== discovery.issuer) {
      throw new OidcError("The id_token carries an iss different from the tenant's issuer.");
    }
    const audList = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audList.includes(this.params.clientId)) {
      throw new OidcError("The id_token does not carry this client_id in aud.");
    }
    if (typeof claims.exp !== "number" || typeof claims.iat !== "number") {
      throw new OidcError("The id_token does not carry exp/iat.");
    }
    if (Date.now() / 1000 >= claims.exp) {
      throw new OidcError("The id_token is expired.");
    }
    if ((claims.nonce ?? null) !== options.nonce) {
      throw new OidcError("The id_token nonce does not match the transaction's.");
    }
    const expectedAtHash = halfHash(options.accessToken, alg);
    if (!timingSafeEqualString(String(claims.at_hash ?? ""), expectedAtHash)) {
      throw new OidcError("The id_token at_hash does not match the access_token.");
    }
    return claims;
  }

  // -- userinfo -----------------------------------------------------------

  /** The userinfo endpoint is not optional for the BFF profile: the email
   * does not travel in the `id_token`, so it is read on every issuance. */
  async userinfo(accessToken: string): Promise<Record<string, unknown>> {
    const discovery = await this.discover();
    const response = await this.ask(discovery.userinfoEndpoint, "userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.status !== 200) {
      throw new OidcError(`userinfo responded ${response.status}.`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  // -- back-channel logout_token -------------------------------------------

  /** Checks the signature (same issuer and algorithms as the `id_token`),
   * `iss`, `aud`, `exp`, the `events` member naming `LOGOUT_EVENT_URI`, `sid`
   * or `sub`, and the absence of `nonce` (the protocol forbids it).
   * Replay of `jti` is the router's job; this method only asserts `jti` is
   * present. */
  async validateLogoutToken(logoutToken: string): Promise<Record<string, unknown>> {
    const { claims } = await this.verifyJws(logoutToken, "logout_token");
    const discovery = await this.discover();
    if (claims.iss !== discovery.issuer) {
      throw new OidcError("The logout_token carries an iss different from the tenant's issuer.");
    }
    const audList = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audList.includes(this.params.clientId)) {
      throw new OidcError("The logout_token does not carry this client_id in aud.");
    }
    if (typeof claims.exp !== "number" || Date.now() / 1000 >= claims.exp) {
      throw new OidcError("The logout_token is expired or does not carry exp.");
    }
    if ("nonce" in claims) {
      throw new OidcError("The logout_token must not carry a nonce (the RFC forbids it).");
    }
    const events = claims.events as Record<string, unknown> | undefined;
    if (!events || typeof events !== "object" || !(LOGOUT_EVENT_URI in events)) {
      throw new OidcError(`The logout_token does not declare the ${LOGOUT_EVENT_URI} event.`);
    }
    if (!claims.sid && !claims.sub) {
      throw new OidcError("The logout_token does not carry sid or sub.");
    }
    if (!claims.jti) {
      throw new OidcError("The logout_token does not carry jti.");
    }
    return claims;
  }

  // -- shared signature verification --------------------------------------

  /** Peeks the unverified header for `kid`/`alg`, resolves the key against
   * the JWKS, verifies the signature and returns `{claims, alg}`. Shared by
   * `validateIdToken` and `validateLogoutToken`: the `logout_token` is signed
   * by the same issuer and with the same algorithms as the `id_token`.
   *
   * The `alg` of the unverified header is only used to pick the digest of
   * `at_hash` (`halfHash`), never as the list of allowed algorithms of
   * `jose.jwtVerify`, which is always the fixed constant `SUPPORTED_ALGS`.
   * Trusting the header for that would let whoever signs the token choose
   * their own algorithm. */
  private async verifyJws(token: string, what: string): Promise<{ claims: Record<string, unknown>; alg: string }> {
    let header: jose.ProtectedHeaderParameters;
    try {
      header = jose.decodeProtectedHeader(token);
    } catch (exc) {
      throw new OidcError(`The ${what} is not a valid JWT: ${(exc as Error).message}`);
    }
    const { kid, alg } = header;
    if (!kid || !alg || !(SUPPORTED_ALGS as readonly string[]).includes(alg)) {
      throw new OidcError(`The ${what} does not carry a recognizable kid/alg in the header.`);
    }
    const entry = await this.keysetFor(kid);
    try {
      const { payload } = await jose.jwtVerify(token, entry.keySet, { algorithms: [...SUPPORTED_ALGS] });
      return { claims: payload as Record<string, unknown>, alg };
    } catch (exc) {
      throw new OidcError(`The ${what} signature does not verify: ${(exc as Error).message}`);
    }
  }
}

function timingSafeEqualString(a: string, b: string): boolean {
  // `at_hash` mismatch is a routine "the token is not for this response",
  // not a secret-guessing surface, but there is no reason not to compare in
  // constant time the same way `safeEqual` does.
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** The pending-login transaction: `state`, `nonce` and PKCE stay on the
 * server side; the browser only receives the sealed transaction cookie.
 * Returned by `newAuthorizationState`, sealed into the `txCookie` by the
 * router. */
export interface AuthorizationState {
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  createdAt: number;
}

/** Builds a fresh `AuthorizationState`. */
export function newAuthorizationState(options: { returnTo?: string } = {}): AuthorizationState {
  return {
    state: newState(),
    nonce: newNonce(),
    code_verifier: generateVerifier(),
    return_to: options.returnTo ?? "/",
    createdAt: Date.now() / 1000,
  };
}

/** The sealed shape of the `txCookie` — a subset of `AuthorizationState`
 * without `createdAt`, matching exactly what `GET /auth/callback`
 * reads back out. */
export interface Transaction {
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  /** Present only for an organization switch: the live session it started
   * from, that session's person and IdP session id, and the selected organization. */
  switch?: { from: string; sid: string | null; sub: string; org: string };
}
