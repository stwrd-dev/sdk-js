/**
 * Reading a request body with a ceiling measured on the stream itself — not on
 * `Content-Length`, which a client chooses — so an oversized body is refused
 * with a 413 before it is held in memory. The ceilings are the ones the
 * Express defaults: 100 KiB for forms and JSON, 5 MiB for webhooks.
 *
 * A body somebody already consumed (`bodyUsed`) reads as empty, as when an
 * app's own global body parser got there first.
 */

export const FORM_LIMIT_BYTES = 100 * 1024;
export const FORM_MAX_FIELDS = 1000;
export const WEBHOOK_LIMIT_BYTES = 5 * 1024 * 1024;

export class BodyTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`The request body is larger than ${limit} bytes.`);
    this.name = "BodyTooLarge";
  }
}

export class BodyInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyInvalid";
  }
}

export async function readBytes(req: Request, limit: number): Promise<Uint8Array> {
  if (req.bodyUsed || req.body === null) {
    return new Uint8Array(0);
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await req.body.cancel().catch(() => undefined);
    throw new BodyTooLarge(limit);
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function mediaType(req: Request): string {
  return (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

function parseForm(text: string): Record<string, unknown> {
  // The ceiling of Express (`parameterLimit`) and of the Python SDK
  // (`max_fields`): one more field than this is a 413, counted before parsing.
  let fields = 1;
  for (let at = text.indexOf("&"); at !== -1; at = text.indexOf("&", at + 1)) {
    if (++fields > FORM_MAX_FIELDS) {
      throw new BodyTooLarge(FORM_LIMIT_BYTES);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const previous = out[key];
    // A repeated key is an array, which no route reads as a string: it counts
    // as absent (the `querystring` behavior of Express). `push`, not a copy,
    // so a body of one repeated key stays linear.
    if (previous === undefined) {
      out[key] = value;
    } else if (Array.isArray(previous)) {
      previous.push(value);
    } else {
      out[key] = [previous, value];
    }
  }
  return out;
}

/** The body as a plain object. `application/x-www-form-urlencoded` always;
 * `application/json` too when `json` is set. Any other content type, or no
 * body, is `{}`. */
export async function readFormBody(req: Request, options: { json?: boolean } = {}): Promise<Record<string, unknown>> {
  const type = mediaType(req);
  const isForm = type === "application/x-www-form-urlencoded";
  const isJson = options.json === true && type === "application/json";
  if (!isForm && !isJson) {
    return {};
  }
  const text = new TextDecoder().decode(await readBytes(req, FORM_LIMIT_BYTES));
  if (isForm) {
    return parseForm(text);
  }
  if (!text.trim()) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BodyInvalid("The request body is not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new BodyInvalid("The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
