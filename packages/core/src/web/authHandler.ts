/**
 * The `/auth/*` routes as one `Request → Response` function. Every adapter
 * serves them through this: `@stwrd-auth/node` wraps it in an Express router,
 * `@stwrd-auth/workers` calls it from a Worker's `fetch`. The Python SDK serves
 * the same routes with the same behavior.
 *
 * The handler answers `null` for anything that is not one of its routes (other
 * path, or a method the route does not take), so the caller falls through to
 * its own routing, as an Express router that did not match would.
 * Errors the handler cannot map to a response (a store that is down while a
 * session is being written) are thrown: what they become — a 500, a 503 — is
 * the adapter's call.
 */

import { randomBytes } from "node:crypto";

import { type BackChannelSink, MemoryBackChannelSink } from "../backchannel.js";
import type { KeepAlive, StwrdCore } from "../client.js";
import { ConfigError } from "../config.js";
import { IdpUnavailable, OidcError, RefreshUncertain, challengeS256, newAuthorizationState, type Transaction } from "../oidc.js";
import {
  type StwrdSession,
  type StwrdUser,
  type Tokens,
  accessExpiry,
  mergeClaims,
  sessionContext,
  sessionResponse,
  userFromClaims,
} from "../sessions.js";
import { DuplicateEventError, InvalidSignatureError, type WebhookEvent, safeEqual } from "../webhooks.js";
import { IDP_SILENT, safeTarget } from "./access.js";
import { BodyInvalid, BodyTooLarge, WEBHOOK_LIMIT_BYTES, readBytes, readFormBody } from "./body.js";
import { clearedCookieHeader, readRequestCookie, setCookieHeader } from "./cookies.js";
import { jsonResponse, redirectResponse, textResponse } from "./response.js";

export interface AuthHandlerOptions {
  /** Runs once per successful `/auth/callback`. Whether this is the very
   * first login for that `sub` is the app's own question, so the hook fires on
   * every login and an idempotent upsert on the app's side is what makes
   * "registered" mean the first one. */
  onUserRegistered?: (user: StwrdUser) => unknown | Promise<unknown>;
  /** Runs once per accepted `/auth/webhook` delivery, after dedup. */
  onEvent?: (event: WebhookEvent) => unknown | Promise<unknown>;
  /** Where back-channel logout ends sessions and remembers `jti`s. Default:
   * process-local memory in front of `stwrd.sessions`. */
  backChannel?: BackChannelSink;
}

type Route = "sign-in" | "callback" | "sign-out" | "session" | "organizations" | "organization" | "back-channel" | "webhook";

const ROUTE_METHOD: Record<Route, "GET" | "POST"> = {
  "sign-in": "GET",
  callback: "GET",
  "sign-out": "POST",
  session: "GET",
  organizations: "GET",
  organization: "POST",
  "back-channel": "POST",
  webhook: "POST",
};

// Matches the way an Express router does: case-insensitive, one optional
// trailing slash, and HEAD answered by the GET route.
function matchRoute(prefix: string, pathname: string, method: string): Route | null {
  const path = (pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname).toLowerCase();
  const base = `${(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix).toLowerCase()}/`;
  if (!path.startsWith(base)) {
    return null;
  }
  const name = path.slice(base.length) as Route;
  if (!Object.hasOwn(ROUTE_METHOD, name)) {
    return null;
  }
  const wanted = ROUTE_METHOD[name];
  return method === wanted || (wanted === "GET" && method === "HEAD") ? name : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sameUuid(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" && UUID_PATTERN.test(left.toLowerCase()) && left.toLowerCase() === right.toLowerCase();
}

function randomSessionId(): string {
  return randomBytes(32).toString("base64url");
}

function queryString(url: URL, name: string): string | undefined {
  // A repeated parameter is an array to Express's query parser, which no route
  // reads as a string: it counts as absent.
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

const NO_STORE = { "cache-control": "no-store" };

export function authHandler(stwrd: StwrdCore, options: AuthHandlerOptions = {}): (req: Request, keepAlive?: KeepAlive) => Promise<Response | null> {
  const sink = options.backChannel ?? new MemoryBackChannelSink(stwrd.sessions);
  const config = stwrd.config;

  const sessionCookieOf = (req: Request) => readRequestCookie(req.headers, config.sessionCookie);
  const shortCookie = (name: string, value: string, maxAgeS: number) =>
    setCookieHeader(name, value, { maxAgeS, secure: config.cookieSecure });

  async function signIn(req: Request, url: URL, keepAlive?: KeepAlive): Promise<Response> {
    const returnTo = safeTarget(queryString(url, "return_to"), "/");
    let session: StwrdSession | null;
    try {
      session = await stwrd.resolveSession(sessionCookieOf(req), keepAlive);
    } catch (exc) {
      if (exc instanceof RefreshUncertain) {
        // That session can never be refreshed: signing in again is the way out.
        session = null;
      } else if (exc instanceof IdpUnavailable) {
        return textResponse(IDP_SILENT, 503);
      } else {
        throw exc;
      }
    }
    if (session) {
      return redirectResponse(returnTo);
    }

    try {
      await stwrd.oidc.discover();
    } catch (exc) {
      if (exc instanceof IdpUnavailable || exc instanceof OidcError) {
        return textResponse(IDP_SILENT, 503);
      }
      throw exc;
    }

    const state = newAuthorizationState({ returnTo });
    const authorizeUrl = await stwrd.oidc.authorizeUrl({
      state: state.state,
      nonce: state.nonce,
      codeChallenge: challengeS256(state.code_verifier),
    });
    const tx: Transaction = {
      state: state.state,
      nonce: state.nonce,
      code_verifier: state.code_verifier,
      return_to: state.return_to,
    };
    return redirectResponse(authorizeUrl, [shortCookie(config.txCookie, stwrd.seal(tx), config.transactionTtlS)]);
  }

  async function callback(req: Request, url: URL): Promise<Response> {
    const tx = stwrd.unseal(readRequestCookie(req.headers, config.txCookie)) as Transaction | null;
    if (!tx || typeof tx !== "object") {
      return textResponse("There is no login transaction in progress.", 400);
    }
    const code = queryString(url, "code");
    const state = queryString(url, "state");
    if (!code || !state || state !== tx.state) {
      return textResponse("The state does not match.", 400);
    }

    let claims: Record<string, unknown>;
    let tokens: Tokens;
    try {
      const tokenResponse = await stwrd.oidc.exchangeCode({ code, codeVerifier: tx.code_verifier });
      const accessToken = tokenResponse.access_token as string;
      const idClaims = await stwrd.oidc.validateIdToken(tokenResponse.id_token as string, {
        nonce: tx.nonce,
        accessToken,
      });
      const userinfoClaims = await stwrd.oidc.userinfo(accessToken);
      // Only verified ID-token claims authorize; userinfo contributes
      // profile and fresh consents after its subject is checked.
      claims = mergeClaims(idClaims, userinfoClaims, idClaims.sub as string);
      tokens = {
        access_token: accessToken,
        id_token: tokenResponse.id_token as string,
        token_type: (tokenResponse.token_type as string | undefined) ?? "Bearer",
        refresh_token: tokenResponse.refresh_token as string | undefined,
        expiresAt: accessExpiry(tokenResponse as { expires_in?: number }),
      };
    } catch (exc) {
      if (exc instanceof IdpUnavailable) {
        // A 503 and not the 400 below: a login that could not be attempted
        // is not a rejected login, and a 400 would hide from the person
        // returning from the IdP that retrying helps.
        return textResponse(IDP_SILENT, 503);
      }
      const message = exc instanceof OidcError ? exc.message : String(exc);
      return textResponse(`The login failed: ${message}`, 400);
    }

    const now = Date.now() / 1000;
    // Derived from the IdP's `sid`, not random: what lets back-channel
    // logout find this row later. A token minted with no `sid` at all gets a
    // random id, which back-channel logout cannot reach.
    const sidClaim = claims.sid as string | undefined;
    const sessionId = sidClaim ? stwrd.sessionIdForSid(sidClaim) : randomSessionId();
    const session: StwrdSession = {
      id: sessionId,
      sidIdp: sidClaim ?? null,
      sub: claims.sub as string,
      claims,
      tokens,
      expiresAt: now + config.sessionTtlS,
      accessExpiresAt: tokens.expiresAt,
    };
    const selection = tx.switch;
    if (selection === undefined) {
      await stwrd.sessions.set(session);
      if (options.onUserRegistered) {
        await options.onUserRegistered(userFromClaims(claims));
      }
    } else {
      // An organization switch only ever replaces the live session it
      // started from, for the same person and exactly the selected
      // organization, under a new IdP session id. A callback that no longer
      // matches (late, replayed, other person) installs nothing.
      if (
        typeof selection !== "object" || claims.sub !== selection.sub ||
        !sameUuid(claims.org_id, selection.org) || !sidClaim || sidClaim === selection.sid
      ) {
        return textResponse("The organization switch did not match.", 400);
      }
      if (!(await stwrd.sessions.replaceSession(String(selection.from), session))) {
        return textResponse("The session this selection started from is gone.", 409);
      }
    }

    // Re-checked here too: the transaction is sealed, but a target that somehow got in
    // unchecked (a cookie from an older version, a custom store) must not become a
    // redirect to another origin. The Python SDK does the same.
    const destination = safeTarget(typeof tx.return_to === "string" ? tx.return_to : undefined, config.postLoginRedirect);
    return redirectResponse(destination, [
      clearedCookieHeader(config.txCookie, { secure: config.cookieSecure }),
      shortCookie(config.sessionCookie, stwrd.seal({ sid: sessionId }), config.sessionTtlS),
    ]);
  }

  async function signOut(req: Request): Promise<Response> {
    const body = await readFormBody(req);
    const session = await stwrd.sessionFromCookie(sessionCookieOf(req));
    if (!session) {
      // No session: redirect to the post-logout destination.
      return redirectResponse(config.postLogoutRedirectUri);
    }

    const fromBody = body.csrf_token;
    const csrf = req.headers.get("x-csrf-token") || (typeof fromBody === "string" ? fromBody : undefined);
    if (!csrf || !safeEqual(csrf, stwrd.csrf(session.id))) {
      return jsonResponse({ detail: "Invalid CSRF token." }, 403);
    }

    await stwrd.sessions.delete(session.id);

    let destination: string;
    if (await stwrd.oidc.supportsEndSession()) {
      const discovery = await stwrd.oidc.discover();
      const endSession = new URL(discovery.endSessionEndpoint as string);
      endSession.searchParams.set("id_token_hint", session.tokens.id_token);
      endSession.searchParams.set("post_logout_redirect_uri", config.postLogoutRedirectUri);
      destination = endSession.toString();
    } else {
      // `end_session_endpoint` not advertised: degrade to the local
      // post-logout redirect, as the Python SDK does.
      destination = config.postLogoutRedirectUri;
    }
    return redirectResponse(destination, [clearedCookieHeader(config.sessionCookie, { secure: config.cookieSecure })]);
  }

  async function session(req: Request, keepAlive?: KeepAlive): Promise<Response> {
    let current: StwrdSession | null;
    try {
      current = await stwrd.resolveSession(sessionCookieOf(req), keepAlive);
    } catch (exc) {
      if (!(exc instanceof IdpUnavailable)) {
        throw exc;
      }
      // Never `authenticated: false` here: a screen would read it as "the
      // session ended" and show the sign-in door to someone who is signed in.
      // A 503 says what is true (it cannot be known) and the client retries.
      return jsonResponse({ detail: IDP_SILENT }, 503, { ...NO_STORE, "retry-after": "5" });
    }
    return jsonResponse(sessionResponse(current, config.accountUrl, current ? stwrd.csrf(current.id) : null), 200, NO_STORE);
  }

  async function organizations(req: Request, keepAlive?: KeepAlive): Promise<Response> {
    if (!stwrd.organizationSelectionEnabled()) {
      return jsonResponse({ detail: "Organization selection is not enabled." }, 404, NO_STORE);
    }
    try {
      const current = await stwrd.resolveSession(sessionCookieOf(req), keepAlive);
      if (!current) {
        return jsonResponse({ detail: "Not authenticated." }, 401, NO_STORE);
      }
      const owned = await stwrd.listOrganizations(current);
      const currentId = sessionContext(current).organization?.id;
      return jsonResponse(
        { organizations: owned.map(org => ({ id: org.id, display_name: org.displayName, current: org.id === currentId })) },
        200,
        NO_STORE,
      );
    } catch (exc) {
      if (exc instanceof IdpUnavailable) {
        return jsonResponse({ detail: IDP_SILENT }, 503, NO_STORE);
      }
      throw exc;
    }
  }

  async function organization(req: Request, keepAlive?: KeepAlive): Promise<Response> {
    const values = await readFormBody(req, { json: true });
    if (!stwrd.organizationSelectionEnabled()) {
      return jsonResponse({ detail: "Organization selection is not enabled." }, 404);
    }
    let current: StwrdSession | null;
    try {
      current = await stwrd.resolveSession(sessionCookieOf(req), keepAlive);
    } catch (exc) {
      if (exc instanceof IdpUnavailable) {
        return jsonResponse({ detail: IDP_SILENT }, 503);
      }
      throw exc;
    }
    if (!current) {
      return jsonResponse({ detail: "Not authenticated." }, 401);
    }
    const csrf = req.headers.get("x-csrf-token") ?? (typeof values.csrf_token === "string" ? values.csrf_token : undefined);
    if (!csrf || !safeEqual(csrf, stwrd.csrf(current.id))) {
      return jsonResponse({ detail: "Invalid CSRF token." }, 403);
    }
    const selected = typeof values.organization_id === "string" ? values.organization_id.toLowerCase() : "";
    if (!UUID_PATTERN.test(selected)) {
      return jsonResponse({ detail: "Invalid organization_id." }, 400);
    }
    let owned: Awaited<ReturnType<typeof stwrd.listOrganizations>>;
    try {
      owned = await stwrd.listOrganizations(current);
    } catch (exc) {
      if (exc instanceof IdpUnavailable) {
        return jsonResponse({ detail: IDP_SILENT }, 503);
      }
      throw exc;
    }
    if (!owned.some(org => org.id === selected)) {
      return jsonResponse({ detail: "Not found." }, 404);
    }
    const returnTo = safeTarget(typeof values.return_to === "string" ? values.return_to : undefined, config.postLoginRedirect);
    const state = newAuthorizationState({ returnTo });
    const authorizeUrl = await stwrd.oidc.authorizeUrl({
      state: state.state,
      nonce: state.nonce,
      codeChallenge: challengeS256(state.code_verifier),
      organizationId: selected,
    });
    const tx: Transaction = {
      state: state.state,
      nonce: state.nonce,
      code_verifier: state.code_verifier,
      return_to: state.return_to,
      switch: { from: current.id, sid: current.sidIdp, sub: current.sub, org: selected },
    };
    return redirectResponse(authorizeUrl, [shortCookie(config.txCookie, stwrd.seal(tx), config.transactionTtlS)]);
  }

  async function backChannel(req: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await readFormBody(req);
    } catch (exc) {
      if (exc instanceof BodyTooLarge) {
        return jsonResponse({ error: "payload_too_large" }, 413, NO_STORE);
      }
      throw exc;
    }
    const logoutToken = body.logout_token;
    if (typeof logoutToken !== "string" || !logoutToken) {
      return jsonResponse({ error: "invalid_request" }, 400, NO_STORE);
    }

    let claims: Record<string, unknown>;
    try {
      claims = await stwrd.oidc.validateLogoutToken(logoutToken);
    } catch (exc) {
      if (exc instanceof IdpUnavailable) {
        // A 503 and not a 400, for safety rather than convenience.
        // `validateLogoutToken` downloads the JWKS to verify the signature, so
        // an issuer hiccup (or a new `kid` during one) ends up here. The
        // issuer retries a 5xx and does not retry a 4xx, so answering 400
        // would lose the notice for good: the IdP ended the session, this
        // BFF would never find out, and the local session would stay alive
        // until it expires on its own. The Python SDK makes the same
        // distinction.
        return jsonResponse({ error: "idp_unavailable" }, 503, NO_STORE);
      }
      return jsonResponse({ error: exc instanceof OidcError ? exc.message : "invalid_request" }, 400, NO_STORE);
    }

    // Delete first, mark the `jti` second: see `backchannel.ts`.
    const sid = claims.sid as string | undefined;
    const outcome = await sink.terminate(sid ? stwrd.sessionIdForSid(sid) : null, claims.jti as string, claims.exp as number);
    if (outcome === "replay") {
      return jsonResponse({ error: "replay" }, 400, NO_STORE);
    }
    return jsonResponse({ status: "ok" }, 200, NO_STORE);
  }

  async function webhook(req: Request): Promise<Response> {
    let bytes: Uint8Array;
    try {
      bytes = await readBytes(req, WEBHOOK_LIMIT_BYTES);
    } catch (exc) {
      if (exc instanceof BodyTooLarge) {
        return jsonResponse({ error: "payload_too_large" }, 413);
      }
      throw exc;
    }
    let event: WebhookEvent;
    try {
      event = stwrd.verifyWebhook(Buffer.from(bytes), headersToRecord(req.headers));
    } catch (exc) {
      if (exc instanceof ConfigError) {
        return jsonResponse({ error: "webhook_not_configured" }, 503);
      }
      if (exc instanceof DuplicateEventError) {
        return jsonResponse({ status: "duplicate" });
      }
      if (exc instanceof InvalidSignatureError) {
        return jsonResponse({ error: "invalid_signature" }, 400);
      }
      throw exc;
    }
    if (options.onEvent) {
      await options.onEvent(event);
    }
    return jsonResponse({ status: "ok" });
  }

  return async (req: Request, keepAlive?: KeepAlive): Promise<Response | null> => {
    const url = new URL(req.url);
    const route = matchRoute(config.prefix, url.pathname, req.method);
    if (route === null) {
      return null;
    }
    try {
      switch (route) {
        case "sign-in":
          return await signIn(req, url, keepAlive);
        case "callback":
          return await callback(req, url);
        case "sign-out":
          return await signOut(req);
        case "session":
          return await session(req, keepAlive);
        case "organizations":
          return await organizations(req, keepAlive);
        case "organization":
          return await organization(req, keepAlive);
        case "back-channel":
          return await backChannel(req);
        case "webhook":
          return await webhook(req);
      }
    } catch (exc) {
      // A body over its ceiling or malformed is the caller's mistake, not ours.
      if (exc instanceof BodyTooLarge) {
        return jsonResponse({ detail: "The request body is too large." }, 413);
      }
      if (exc instanceof BodyInvalid) {
        return jsonResponse({ detail: exc.message }, 400);
      }
      throw exc;
    }
  };
}
