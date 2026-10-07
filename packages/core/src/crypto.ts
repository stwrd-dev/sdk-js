/**
 * `sign` / `unsign` / `csrfToken` — the raw HMAC primitives that cookie
 * sealing, CSRF tokens and the derivation of a session id from `sid` build on.
 * They are free `(secret, data)` functions, so the router can derive a session
 * id with `sign(secret, "sid:" + sid)` and no dedicated helper.
 */

import { createHmac } from "node:crypto";

import { safeEqual } from "./webhooks.js";

/** HMAC-SHA256 of `data` under `secret`, base64url with no padding. */
export function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf-8").digest("base64url");
}

/** Constant-time check that `signature` is `sign(secret, data)`. */
export function unsign(secret: string, data: string, signature: string): boolean {
  return safeEqual(signature, sign(secret, data));
}

/** A CSRF token derived from the session id, not stored separately —
 * recomputing it is a comparison, never a lookup. */
export function csrfToken(secret: string, sessionId: string): string {
  return sign(secret, `csrf:${sessionId}`);
}
