/**
 * Small HTTP plumbing shared by `client.ts`, `router.ts` and `guards.ts`.
 * Nothing here is exported from `index.ts`.
 *
 * Cookies are read straight off the raw `Cookie` header rather than through
 * `req.cookies` (which needs the `cookie-parser` middleware): this SDK works
 * whether or not an app happens to have that installed, and parsing
 * `name=value; name=value` pairs is plain string splitting.
 */

import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

import { parseCookies } from "@stwrd-auth/core/web/cookies";

export function readCookie(req: Pick<IncomingMessage, "headers">, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

/** Every header value Express-family requests can hand back, coerced to the
 * plain `Record<string, string>` the webhook verifier expects. A repeated header keeps its first
 * value — Standard Webhooks never sends the three signing headers more than
 * once. */
export function headersToRecord(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    out[key] = Array.isArray(value) ? (value[0] ?? "") : value;
  }
  return out;
}
