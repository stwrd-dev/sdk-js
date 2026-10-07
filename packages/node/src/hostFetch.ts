/**
 * `makeHostFetch` — a `FetchLike` that connects to a fixed address while
 * sending an arbitrary `Host` header. The identity provider resolves the
 * tenant by `Host`, so an app developing against one on `127.0.0.1` still has
 * to talk to it as `idp.example.com`; this is how, without `/etc/hosts` or
 * real DNS.
 *
 * Global `fetch` (undici) treats `Host` as a protected header and overwrites it
 * to match the connection's own authority. `node:http.request` has no such
 * restriction (`options.host`/`options.port` pick the TCP peer,
 * `options.headers.Host` is sent as-is), so this wraps that instead and
 * adapts the result back into a real `Response`, keeping every caller
 * (`OidcClient` and the rest) working against the same Fetch-API shape.
 */

import { type IncomingMessage, request as httpRequest } from "node:http";

import type { FetchLike } from "@stwrd-auth/core/oidc";

export interface HostFetchOptions {
  /** Where the TCP connection goes — `127.0.0.1` for a local IdP. */
  connectHost: string;
  connectPort: number;
  /** The `Host` header sent as-is — the issuer's host, what the IdP routes by. */
  host: string;
}

export function makeHostFetch(options: HostFetchOptions): FetchLike {
  return async function hostFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    headers.host = options.host;

    const bodyBuffer = await toBuffer(init.body as SupportedBody | null | undefined);
    if (bodyBuffer && headers["content-length"] === undefined) {
      headers["content-length"] = String(bodyBuffer.length);
    }

    return new Promise<Response>((resolve, reject) => {
      const req = httpRequest(
        {
          host: options.connectHost,
          port: options.connectPort,
          method,
          path: `${url.pathname}${url.search}`,
          headers,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value === undefined) {
                continue;
              }
              for (const one of Array.isArray(value) ? value : [value]) {
                responseHeaders.append(key, one);
              }
            }
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode ?? 0,
                statusText: res.statusMessage,
                headers: responseHeaders,
              }),
            );
          });
        },
      );
      req.on("error", reject);
      if (bodyBuffer) {
        req.write(bodyBuffer);
      }
      req.end();
    });
  };
}

type SupportedBody = string | Buffer | URLSearchParams | ArrayBuffer;

async function toBuffer(body: SupportedBody | null | undefined): Promise<Buffer | null> {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body === "string") {
    return Buffer.from(body, "utf-8");
  }
  if (body instanceof URLSearchParams) {
    return Buffer.from(body.toString(), "utf-8");
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  // Anything else Fetch's `BodyInit` allows (a `Blob`, a stream): none of
  // the SDK's own requests need it, so this is a deliberately narrow adapter
  // and not a full `BodyInit` implementation.
  throw new TypeError("makeHostFetch: unsupported body (only string, Buffer, URLSearchParams or ArrayBuffer).");
}
