/**
 * Access guards on `Request → Response` terms: given the session cookie and
 * how the request arrived, decide to let it through or build the exact response
 * that stops it. `@stwrd-auth/node` wraps this in Express middleware
 * (`requireAuth`, `requireRole`, ...); `@stwrd-auth/workers` calls it straight
 * from a Worker. The session context is resolved once per request.
 *
 * One rule is shared by every guard: "cannot tell" is never translated into
 * "no session". When the IdP does not answer while resolving the
 * session, the answer is a 503, never the 401 / redirect to sign-in that would
 * tell a person with a live session that they lost it.
 */

import { ConfigError } from "../config.js";
import type { KeepAlive, StwrdCore } from "../client.js";
import { IdpUnavailable } from "../oidc.js";
import { type SessionContext, type StwrdSession, hasPermission, hasRole, sessionContext } from "../sessions.js";
import { jsonResponse, redirectResponse } from "./response.js";

/** What a person is told when the IdP did not respond. The same sentence as
 * the Python SDK and as `/auth/sign-in`: it is the same fact, and whoever reads
 * it cannot tell which door it came through. */
export const IDP_SILENT = "The IdP did not respond.";

/** The session context plus the private session itself. */
export interface AccessContext extends SessionContext {
  session: StwrdSession | null;
}

/** What resolving a request's session produced. `idpUnavailable` is the fact
 * `context.user === null` cannot carry: the IdP did not answer, so there is
 * no user to show — which is different from there being none. */
export interface Resolution {
  context: AccessContext;
  idpUnavailable: boolean;
}

export type AccessRule = { auth: true } | { role: string } | { permission: string } | { org: true };

export interface AccessInput {
  /** The value of the session cookie, if the request carried one. */
  cookie?: string | null;
  /** The `Accept` header. */
  accept?: string | null;
  /** Where to come back to after signing in: the request's path and query. */
  target: string;
  /** Force a 401 JSON denial even for a browser navigation. */
  api?: boolean;
  /** A resolution already made for this request; the session is not read twice. */
  resolved?: Resolution;
}

export type AccessResult = { ok: true; context: AccessContext } | { ok: false; response: Response };

/** Resolves the session once. Does NOT throw `IdpUnavailable`: it is recorded
 * in the result, so a public route with no guard still renders (it has no
 * session to lose) and each guard decides for itself. Anything else the store
 * throws propagates. */
export async function resolveAccess(stwrd: StwrdCore, cookie: string | null | undefined, keepAlive?: KeepAlive): Promise<Resolution> {
  let session: StwrdSession | null = null;
  let idpUnavailable = false;
  try {
    session = await stwrd.resolveSession(cookie, keepAlive);
  } catch (exc) {
    if (!(exc instanceof IdpUnavailable)) {
      throw exc;
    }
    // Marked and NOT raised: `user: null` without the mark would read as
    // "anonymous", which is the lie that logs people out.
    idpUnavailable = true;
  }
  return { context: { ...sessionContext(session), session }, idpUnavailable };
}

/** Whether a denial is a 401 JSON: `api` forces it; absent that, a request
 * that accepts `text/html` is a navigation and gets the redirect instead. */
export function wantsJson(accept: string | null | undefined, api = false): boolean {
  return api || !(accept ?? "").includes("text/html");
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** A redirect target confined to this app: only an absolute path with no
 * protocol-relative (`//host/...`) escape and no control character passes,
 * everything else falls back. A URL parser drops a tab or a line break, so
 * `/\t/evil.example` would resolve to `//evil.example`. Used to build
 * `return_to=` from the request's own URL, and exposed so an app can apply
 * the same rule to a redirect target it read from somewhere less trustworthy
 * (a query param, a stored value). */
export function safeTarget(candidate: string | null | undefined, fallback = "/"): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\") || CONTROL_CHARACTER.test(candidate)) {
    return fallback;
  }
  return candidate;
}

/** The `return_to` of a request that is sent to sign in: its own path and
 * query, if that is a path of this app. */
export function returnTo(target: string): string {
  return safeTarget(target);
}

/** Where a denied navigation is sent: the sign-in route, coming back to `target`. */
export function signInLocation(stwrd: StwrdCore, target: string): string {
  return `${stwrd.config.prefix}/sign-in?return_to=${encodeURIComponent(returnTo(target))}`;
}

/** Everything under the auth prefix is public without being listed
 * — otherwise the redirect target itself would need a session, and the webhook
 * receiver would 401 forever. A trailing `*` in an entry is a prefix match; a
 * `*` anywhere else is a character, not a wildcard. */
export function isPublicPath(path: string, publicList: readonly string[], authPrefix: string): boolean {
  if (path === authPrefix || path.startsWith(`${authPrefix}/`)) {
    return true;
  }
  for (const entry of publicList) {
    if (entry.endsWith("*")) {
      if (path.startsWith(entry.slice(0, -1))) {
        return true;
      }
    } else if (path === entry) {
      return true;
    }
  }
  return false;
}

/** `requireOrg` only makes sense when the `org` scope was requested; the
 * guard refuses to exist otherwise (fail closed, at construction time). */
export function assertOrgRuleAvailable(stwrd: StwrdCore): void {
  if (!stwrd.organizationSelectionEnabled()) {
    throw new ConfigError("requireOrg requires the org scope.");
  }
}

export function idpSilentResponse(): Response {
  return jsonResponse({ detail: IDP_SILENT }, 503, { "retry-after": "5" });
}

function deny(stwrd: StwrdCore, input: AccessInput): Response {
  if (wantsJson(input.accept, input.api)) {
    return jsonResponse({ detail: "No session." }, 401);
  }
  return redirectResponse(signInLocation(stwrd, input.target));
}

/** Applies one rule to a request. Order matters and is the same for every
 * rule: IdP silent → 503; no user → 401 JSON or the redirect to sign-in; user
 * but the rule fails → 403. */
export async function checkAccess(stwrd: StwrdCore, input: AccessInput, rule: AccessRule): Promise<AccessResult> {
  if ("org" in rule) {
    assertOrgRuleAvailable(stwrd);
  }
  const { context, idpUnavailable } = input.resolved ?? (await resolveAccess(stwrd, input.cookie));
  if (idpUnavailable) {
    return { ok: false, response: idpSilentResponse() };
  }
  if (!context.user) {
    return { ok: false, response: deny(stwrd, input) };
  }
  if ("role" in rule && !hasRole(context, rule.role)) {
    return { ok: false, response: jsonResponse({ detail: `Missing role ${rule.role}.` }, 403) };
  }
  if ("permission" in rule && !hasPermission(context, rule.permission)) {
    return { ok: false, response: jsonResponse({ detail: `Missing permission ${rule.permission}.` }, 403) };
  }
  if ("org" in rule && !context.organization) {
    return { ok: false, response: jsonResponse({ detail: "The session has no organization." }, 403) };
  }
  return { ok: true, context };
}
