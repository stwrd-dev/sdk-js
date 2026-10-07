/**
 * The seam between Express and the core's `Request → Response` handlers:
 * `toWebRequest` builds the Fetch `Request` the core reads, `sendWebResponse`
 * writes the core's `Response` back. Nothing here decides anything about
 * authentication; it only translates. Internal — not exported from `index.ts`.
 *
 * Two rules make the translation safe:
 *
 * - The URL is relative to where the router is mounted (`req.url`, not
 *   `originalUrl`: `app.use("/api", stwrd.authRouter())` still serves
 *   `/api/auth/sign-in`) and its origin comes from `config.baseUrl`, never from
 *   the `Host` header: a spoofed `Host` cannot move a `redirect_uri`.
 * - A body is only read when the core asks for it, so a request this router
 *   does not serve reaches the app's own handlers with its body intact.
 */

import type { IncomingMessage } from "node:http";

import type { Response as ExpressResponse, Request as ExpressRequest } from "express";

import type { StwrdCore } from "@stwrd-auth/core/client";

type ParsedBodyRequest = ExpressRequest & { _body?: boolean };

/** A body the app's own global parser (`express.json()`, `express.urlencoded()`,
 * `express.raw()`) already consumed: the stream is gone, `req.body` is what is left. */
function wasConsumed(req: ParsedBodyRequest): boolean {
  return req._body === true || req.readableDidRead === true || req.readableEnded;
}

function isWebhookPath(pathname: string, prefix: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return path.toLowerCase() === `${prefix.replace(/\/$/, "")}/webhook`.toLowerCase();
}

/** Puts back on the wire what a global parser took off it, by content type, so
 * the routes that read a form or JSON (sign-out, organization, back-channel)
 * still see it. The webhook is the exception: it verifies a signature over the
 * exact bytes, which a parsed object cannot give back, so it
 * only accepts a raw `Buffer` body and otherwise reads as empty (400
 * `invalid_signature`). */
function reserialize(req: ParsedBodyRequest, webhook: boolean): { body: Uint8Array | string | null } {
  const body: unknown = req.body;
  if (Buffer.isBuffer(body)) {
    return { body };
  }
  if (webhook || body === undefined || body === null) {
    return { body: null };
  }
  if (typeof body === "string") {
    return { body };
  }
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded" && typeof body === "object") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          params.append(key, String(item));
        }
      }
    }
    return { body: params.toString() };
  }
  if (type === "application/json") {
    return { body: JSON.stringify(body) };
  }
  return { body: null };
}

/** The request stream as a Fetch body that attaches to the Node stream only on
 * the first read, and drains (instead of destroying the connection) when the
 * core stops reading because a ceiling was crossed: the 413 still has a socket
 * to travel on. */
function lazyBody(req: IncomingMessage): ReadableStream<Uint8Array> {
  let started = false;
  let cancelled = false;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (started) {
          req.resume();
          return;
        }
        started = true;
        req.on("data", (chunk: Buffer) => {
          if (cancelled) return;
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
          if ((controller.desiredSize ?? 0) <= 0) req.pause();
        });
        req.on("end", () => {
          if (!cancelled) controller.close();
        });
        req.on("error", (error) => {
          if (!cancelled) controller.error(error);
        });
        req.on("close", () => {
          if (!cancelled && !req.complete) controller.error(new Error("The request was aborted."));
        });
      },
      cancel() {
        cancelled = true;
        req.resume();
      },
    },
    { highWaterMark: 0 },
  );
}

/** The Fetch `Request` for an Express one, or `null` when the URL parser would
 * rewrite its path (`/auth/x/../session`, `/auth/x/..\\session`): the router
 * does not serve such a path, and answering it would let a request slip past a
 * WAF or CDN rule on the exact path. The app gets it as it came. */
export function toWebRequest(req: ExpressRequest, stwrd: StwrdCore): globalThis.Request | null {
  const target = req.url.startsWith("/") ? req.url : `/${req.url}`;
  const url = new URL(new URL(stwrd.config.baseUrl).origin + target);
  if (url.pathname !== target.split(/[?#]/, 1)[0]) {
    return null;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name.startsWith(":")) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return new Request(url, { method: req.method, headers });
  }
  if (wasConsumed(req)) {
    const { body } = reserialize(req, isWebhookPath(url.pathname, stwrd.config.prefix));
    // The bytes put back are not the ones the headers describe.
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return new Request(url, { method: req.method, headers, body: body as RequestInit["body"] });
  }
  return new Request(url, { method: req.method, headers, body: lazyBody(req), duplex: "half" } as RequestInit);
}

/** Status, headers and every `Set-Cookie` of the core's response, then its body. */
export async function sendWebResponse(res: ExpressResponse, response: globalThis.Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") res.setHeader(name, value);
  });
  for (const cookie of response.headers.getSetCookie()) {
    res.append("Set-Cookie", cookie);
  }
  if (response.body === null) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
