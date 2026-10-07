/**
 * Cookie plumbing shared by the adapters. Cookies are read straight off the
 * raw `Cookie` header rather than through a framework parser: the SDK works
 * whether or not an app happens to have one installed, and parsing
 * `name=value; name=value` pairs is plain string splitting.
 */

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    if (!name) {
      continue;
    }
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

// `Set-Cookie` lines in the shape Express 4 (`res.cookie`/`res.clearCookie`
// over the `cookie` package) produces:
//   name=value; Max-Age=N; Path=/; Expires=<UTC>; HttpOnly; Secure; SameSite=Lax
// and, for a deletion, `name=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
// with the same `HttpOnly`, `Secure` and `SameSite` attributes.

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function assertCookieName(name: string): void {
  if (!COOKIE_NAME.test(name)) {
    throw new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`);
  }
}

export interface SetCookieOptions {
  /** Lifetime, in whole seconds. */
  maxAgeS: number;
  secure: boolean;
  /** The clock, in epoch milliseconds; only tests pass it. */
  nowMs?: number;
}

/** A host-only, `HttpOnly`, `SameSite=Lax` cookie on `Path=/` (no `Domain`:
 * the `__Host-` prefix forbids it). */
export function setCookieHeader(name: string, value: string, options: SetCookieOptions): string {
  assertCookieName(name);
  const maxAgeS = Math.floor(options.maxAgeS);
  const expires = new Date((options.nowMs ?? Date.now()) + maxAgeS * 1000);
  return (
    `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeS}; Path=/; Expires=${expires.toUTCString()}; HttpOnly` +
    `${options.secure ? "; Secure" : ""}; SameSite=Lax`
  );
}

/** Deletes a cookie set by `setCookieHeader`, with the attributes it was set
 * with. `Secure` is what matters: a browser refuses a deletion of a `__Host-`
 * cookie that is not `Secure`, and the session cookie would outlive the
 * sign-out. `Max-Age=0` and the epoch `Expires` both ask for the deletion. */
export function clearedCookieHeader(name: string, options: { secure: boolean }): string {
  assertCookieName(name);
  return `${name}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${options.secure ? "; Secure" : ""}; SameSite=Lax`;
}

/** The value of one cookie of the request, or `undefined`. */
export function readRequestCookie(headers: Headers, name: string): string | undefined {
  return parseCookies(headers.get("cookie"))[name];
}
