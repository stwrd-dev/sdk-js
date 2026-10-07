/**
 * A tiny real-HTTP harness for exercising an Express app end to end —
 * `authRouter`/guards/`protectAll` need a real request/response cycle
 * (cookies, redirects, `Content-Type`), which nothing short of a listening
 * server gives for free in Node. It can also drive a real identity provider
 * through the `fetchImpl` option.
 */

import type { AddressInfo } from "node:net";

import type { Express } from "express";

export class TestServer {
  private server: import("node:http").Server | null = null;
  baseUrl = "";

  async start(app: Express): Promise<string> {
    this.server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      this.server?.once("listening", () => resolve());
      this.server?.once("error", reject);
    });
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

/** A minimal cookie jar: enough to carry `Set-Cookie` from one `fetch` call
 * into the next `Cookie` header, the same round trip a browser's jar does
 * for the login/callback/me/sign-out dance these tests drive. */
export class CookieJar {
  private readonly values = new Map<string, string>();

  absorb(response: Response): void {
    // Node's fetch (undici) exposes multiple `Set-Cookie` values through
    // `headers.getSetCookie()` — `headers.get("set-cookie")` alone only
    // ever returns the first one joined, which would silently drop the
    // second cookie a response sets (session + a cleared tx cookie, e.g.).
    const raw = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(";");
      if (!pair) {
        continue;
      }
      const eq = pair.indexOf("=");
      if (eq === -1) {
        continue;
      }
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      // `res.clearCookie()` sets an empty value with an epoch `Expires` —
      // treat that as a deletion rather than storing an empty string.
      if (/expires=thu, 01 jan 1970/i.test(line)) {
        this.values.delete(name);
      } else {
        this.values.set(name, value);
      }
    }
  }

  header(): string {
    return [...this.values.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  set(name: string, value: string): void {
    this.values.set(name, value);
  }

  clear(): void {
    this.values.clear();
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface JarFetchInit extends RequestInit {
  jar: CookieJar;
  /** Defaults to the global `fetch`. Passing a `makeHostFetch` instance lets
   * the same jar-and-manual-redirect plumbing drive both the demo app (plain
   * loopback) and a real identity provider (loopback + a spoofed `Host`). */
  fetchImpl?: FetchFn;
}

/** `fetch`, with the jar's cookies attached and any `Set-Cookie` on the
 * response absorbed back in — always `redirect: "manual"`: these tests assert
 * on the redirect itself, not on where it eventually lands. */
export async function jarFetch(url: string, init: JarFetchInit): Promise<Response> {
  const { jar, headers, fetchImpl, ...rest } = init;
  const cookieHeader = jar.header();
  const merged = new Headers(headers);
  if (cookieHeader) {
    merged.set("cookie", cookieHeader);
  }
  const response = await (fetchImpl ?? fetch)(url, { ...rest, headers: merged, redirect: "manual" });
  jar.absorb(response);
  return response;
}
