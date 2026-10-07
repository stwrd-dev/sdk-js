// Drives `authHandler` directly with `Request` objects, the way a Worker does:
// no Express, no socket. A cookie jar carries `Set-Cookie` into the next call.
import { expect } from "vitest";

import type { StwrdCore } from "../../src/client.js";
import { type AuthHandlerOptions, authHandler } from "../../src/web/authHandler.js";
import { BASE_URL, type InProcessIdp } from "./inProcessIdp.js";

export class Jar {
  private readonly values = new Map<string, string>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      if (/expires=thu, 01 jan 1970/i.test(line)) this.values.delete(name);
      else this.values.set(name, pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  get(name: string): string | undefined {
    return this.values.get(name);
  }
  set(name: string, value: string): void {
    this.values.set(name, value);
  }
}

export interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  body?: NonNullable<RequestInit["body"]> | null;
  jar?: Jar;
}

export function request(path: string, init: CallInit = {}): Request {
  const headers = new Headers(init.headers);
  const cookie = init.jar?.header();
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${BASE_URL}${path}`, { method: init.method ?? "GET", headers, body: init.body ?? null });
}

export function driver(stwrd: StwrdCore, options: AuthHandlerOptions = {}) {
  const handle = authHandler(stwrd, options);
  const call = async (path: string, init: CallInit = {}): Promise<Response> => {
    const response = await handle(request(path, init));
    expect(response, `${init.method ?? "GET"} ${path} was not served`).not.toBeNull();
    init.jar?.absorb(response as Response);
    return response as Response;
  };
  return { handle, call };
}

export interface LoginOptions {
  returnTo?: string;
  idClaims?: Record<string, unknown>;
  userinfo?: Record<string, unknown>;
  withRefresh?: boolean;
}

/** sign-in → issue a code for the transaction → callback. */
export async function login(
  call: (path: string, init?: CallInit) => Promise<Response>,
  jar: Jar,
  idp: InProcessIdp,
  options: LoginOptions = {},
): Promise<Response> {
  const signIn = await call(`/auth/sign-in?return_to=${encodeURIComponent(options.returnTo ?? "/private")}`, { jar });
  expect(signIn.status).toBe(303);
  const location = new URL(signIn.headers.get("location") as string);
  const code = idp.issueCode({
    nonce: location.searchParams.get("nonce"), idClaims: options.idClaims, userinfo: options.userinfo, withRefresh: options.withRefresh,
  });
  return call(`/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar });
}
