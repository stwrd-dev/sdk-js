/**
 * The few response shapes the `/auth/*` routes and the access guards produce.
 * Content types carry `; charset=utf-8` and a redirect is a bare 303; every cookie goes out as its own
 * `Set-Cookie` header (`Headers.append`, never a comma-joined value).
 */

const JSON_TYPE = "application/json; charset=utf-8";
const TEXT_TYPE = "text/plain; charset=utf-8";

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}, cookies: string[] = []): Response {
  return build(JSON.stringify(body), status, { "content-type": JSON_TYPE, ...headers }, cookies);
}

export function textResponse(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return build(text, status, { "content-type": TEXT_TYPE, ...headers }, []);
}

export function redirectResponse(location: string, cookies: string[] = [], status = 303): Response {
  return build(null, status, { location: encodeUrl(location) }, cookies);
}

function build(body: string | null, status: number, headers: Record<string, string>, cookies: string[]): Response {
  const out = new Headers(headers);
  for (const cookie of cookies) {
    out.append("set-cookie", cookie);
  }
  return new Response(body, { status, headers: out });
}

// Same rule as `encodeurl` (what Express runs on `Location`): percent-encode what a header
// cannot carry (spaces, non-ASCII, lone surrogates) and leave valid escapes and
// the URL's own punctuation alone. A header value outside Latin-1 would
// otherwise make `Headers` throw on a `return_to` the person typed.
const ENCODE_CHARS = /(?:[^\x21\x23-\x3B\x3D\x3F-\x5F\x61-\x7A\x7C\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g;
const UNMATCHED_SURROGATE_PAIR = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g;

export function encodeUrl(url: string): string {
  return String(url).replace(UNMATCHED_SURROGATE_PAIR, "$1�$2").replace(ENCODE_CHARS, encodeURI);
}
