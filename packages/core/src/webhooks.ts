/**
 * Standard Webhooks verification and signing.
 *
 * HMAC-SHA256 over `"{id}.{timestamp}.{body}"` is the protocol itself here (it
 * fixes the exact byte layout), so it goes straight at Node's built-in
 * `node:crypto` rather than a third dependency for one function.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The three header names, lowercase, read case-insensitively. */
export const HEADER_ID = "webhook-id";
export const HEADER_TIMESTAMP = "webhook-timestamp";
export const HEADER_SIGNATURE = "webhook-signature";

/** The signature header value is `v1,<base64(HMAC-SHA256(...))>`. */
export const SIGNATURE_PREFIX = "v1,";

/** The replay window: 300 s. */
export const TOLERANCE_S = 300;

/**
 * `SeenEventIds` deduplicates over a 30 h window. The window is a convenience
 * of the process (in memory, lost on restart), not a guarantee. This is its
 * pruning window.
 */
export const DEDUP_WINDOW_S = 30 * 3600;

// Accepted if it matches `^-?\d+$` (ASCII digits, optionally surrounded by
// whitespace) and nothing else. JS's `\d` is ASCII-only by default (unlike
// Python's, which matches every Unicode decimal digit), so no extra flag is
// needed to reject Unicode digits.
const TIMESTAMP_RE = /^\s*-?\d+\s*$/;

/**
 * The delivery is rejected: missing/malformed headers, a timestamp outside
 * the replay window, or no candidate signature that matches. Any bad header
 * is rejected cleanly, like any other bad signature, never as a 500. This is
 * the one error every rejection throws, deliberately without a
 * machine-readable reason on it.
 */
export class InvalidSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSignatureError";
  }
}

/**
 * Thrown only when a `seen` store is passed and the event `id` was already
 * delivered. A receiver has to be idempotent by `id`; this is what lets a
 * caller answer `200 {"status":"duplicate"}` instead of reprocessing.
 */
export class DuplicateEventError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(`Event ${eventId} was already processed.`);
    this.name = "DuplicateEventError";
    this.eventId = eventId;
  }
}

/** Strict public v1 envelope. Raw signature verification does not parse it. */
export interface WebhookEvent {
  id: string;
  type: string;
  api_version: "v1";
  created_at: string;
  data: Record<string, unknown>;
}

/** A store `verifyWebhook`'s `seen` option accepts: a plain `Set<string>`
 * satisfies this, and so does `SeenEventIds`. */
export interface SeenStore {
  has(id: string): boolean;
  add(id: string): void;
}

export interface VerifyWebhookOptions {
  toleranceS?: number;
  seen?: SeenStore;
}

/**
 * Constant-time string comparison. Shared with the cookie and CSRF sealing, so
 * there is a single HMAC-comparison implementation.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  // `crypto.timingSafeEqual` throws on a length mismatch rather than
  // returning `false`, so the length check has to happen outside it.
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  // Case-insensitive lookup without assuming the caller's object is:
  // Node's own `http.IncomingMessage.headers` already lower-cases keys, but
  // this function works for any caller regardless.
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return value;
    }
  }
  return undefined;
}

function candidateSignatures(headerValue: string): string[] {
  return headerValue
    .split(/\s+/)
    .filter((token) => token.startsWith(SIGNATURE_PREFIX))
    .map((token) => token.slice(SIGNATURE_PREFIX.length));
}

function hmacBase64(secret: string, signedContent: Buffer): string {
  return createHmac("sha256", secret).update(signedContent).digest("base64");
}

/**
 * One `v1,<base64>` signature candidate for `{eventId}.{timestamp}.{body}` —
 * the sending side of the scheme. Exposed for a receiver that wants to build
 * its own test deliveries, or for relaying/re-signing a webhook payload.
 */
export function signWebhook(
  secret: string,
  options: { eventId: string; timestamp: string; body: string | Buffer },
): string {
  const bodyBuffer = typeof options.body === "string" ? Buffer.from(options.body, "utf-8") : options.body;
  const signedContent = Buffer.concat([
    Buffer.from(`${options.eventId}.${options.timestamp}.`, "utf-8"),
    bodyBuffer,
  ]);
  return SIGNATURE_PREFIX + hmacBase64(secret, signedContent);
}

/**
 * Verify one delivery and return its parsed `WebhookEvent`.
 *
 * Throws `InvalidSignatureError` for anything about the signature or the
 * timestamp, and `DuplicateEventError` if `options.seen` says this `id`
 * already came through.
 */
export function verifyWebhookSignature(
  body: string | Buffer,
  headers: Record<string, string>,
  secret: string,
  options: VerifyWebhookOptions = {},
): string {
  const toleranceS = options.toleranceS ?? TOLERANCE_S;

  const eventId = getHeader(headers, HEADER_ID);
  const timestampRaw = getHeader(headers, HEADER_TIMESTAMP);
  const signatureHeader = getHeader(headers, HEADER_SIGNATURE);
  if (!eventId || !timestampRaw || !signatureHeader) {
    throw new InvalidSignatureError("Missing webhook-id/timestamp/signature headers.");
  }

  if (!TIMESTAMP_RE.test(timestampRaw)) {
    throw new InvalidSignatureError("webhook-timestamp is not a valid ASCII integer.");
  }
  const timestamp = Number.parseInt(timestampRaw, 10);
  const nowS = Date.now() / 1000;
  if (Math.abs(nowS - timestamp) > toleranceS) {
    throw new InvalidSignatureError("The delivery is outside the replay window.");
  }

  const bodyBuffer = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  // The timestamp enters the HMAC as the exact header string, not as the
  // parsed integer: `timestampRaw`, never `String(timestamp)`.
  const expected = signWebhook(secret, { eventId, timestamp: timestampRaw, body: bodyBuffer }).slice(
    SIGNATURE_PREFIX.length,
  );

  const candidates = candidateSignatures(signatureHeader);
  let matched = false;
  for (const candidate of candidates) {
    // Never short-circuits on the first match; `safeEqual` already treats a
    // length mismatch (which a candidate with non-ASCII/garbled bytes
    // produces once base64-decoded lengths differ) as a clean `false`
    // rather than throwing, so it is answered as any other bad signature,
    // never as a 500.
    if (safeEqual(candidate, expected)) {
      matched = true;
    }
  }
  if (!matched) {
    throw new InvalidSignatureError("No signature matches.");
  }

  return eventId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|\+00:00)$/;

function isUtcInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = UTC_DATE_RE.exec(value);
  if (parts === null) return false;
  const date = new Date(value);
  // Date.parse can normalize impossible dates such as February 30. Compare
  // every calendar component rather than accepting that normalization.
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 &&
    [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
      date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
      .every((component, index) => component === Number(parts[index + 1]));
}

export function verifyWebhook(
  body: string | Buffer,
  headers: Record<string, string>,
  secret: string,
  options: VerifyWebhookOptions = {},
): WebhookEvent {
  const eventId = verifyWebhookSignature(body, headers, secret, options);
  const bodyBuffer = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  let doc: WebhookEvent;
  try {
    doc = JSON.parse(bodyBuffer.toString("utf-8"));
  } catch {
    throw new InvalidSignatureError("The body is not valid JSON.");
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc) || typeof doc.id !== "string" || doc.id.length !== 36 || !UUID_RE.test(doc.id) ||
      eventId.length !== 36 || !UUID_RE.test(eventId) || doc.id !== eventId ||
      typeof doc.type !== "string" || !doc.type || doc.api_version !== "v1" ||
      !isUtcInstant(doc.created_at) || !doc.data || typeof doc.data !== "object" ||
      Array.isArray(doc.data) || Object.keys(doc).sort().join(",") !== "api_version,created_at,data,id,type") {
    throw new InvalidSignatureError("The body is not a v1 webhook event.");
  }

  if (options.seen) {
    if (options.seen.has(eventId)) {
      throw new DuplicateEventError(eventId);
    }
    options.seen.add(eventId);
  }

  return {
    id: doc.id,
    type: doc.type,
    api_version: doc.api_version,
    created_at: doc.created_at,
    data: doc.data ?? {},
  };
}

/**
 * `SeenEventIds`: an in-process, self-pruning dedup set.
 *
 * The window is a convenience of the process (in memory, lost on restart),
 * not a guarantee, so this is deliberately not persisted anywhere; a
 * receiver's real idempotence has to come from its own storage, keyed by
 * `id`.
 */
export class SeenEventIds implements SeenStore {
  private readonly windowS: number;
  private readonly seenAt = new Map<string, number>();

  constructor(windowS: number = DEDUP_WINDOW_S) {
    this.windowS = windowS;
  }

  has(id: string): boolean {
    this.prune();
    return this.seenAt.has(id);
  }

  add(id: string): void {
    this.prune();
    this.seenAt.set(id, Date.now() / 1000);
  }

  private prune(): void {
    const cutoff = Date.now() / 1000 - this.windowS;
    for (const [id, seenAt] of this.seenAt) {
      // `<=`, not `<`: `Date.now()` is millisecond-resolution, so two calls
      // microseconds apart can read back the identical value — a
      // `windowS=0` store (immediately stale) has to prune on a tie, not
      // depend on real time having strictly advanced.
      if (seenAt <= cutoff) {
        this.seenAt.delete(id);
      }
    }
  }
}
