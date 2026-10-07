// What differs from Node when a Worker renews a session (owner's decision,
// 2026-10-07): the IdP is probed before the exchange is marked as sent, and the
// wait for another owner's refresh grows. workerd gives no proof that a failed
// exchange never left, so without the probe an IdP that is down costs a session.
import { env as workerEnv } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StwrdCore } from "@stwrd-auth/core/client";
import { IdpUnavailable, type FetchLike } from "@stwrd-auth/core/oidc";
import { MemoryStore, type StwrdSession } from "@stwrd-auth/core/sessions";
import { FakeIdp } from "../../../node/tests/fixtures/fakeIdp.js";
import { WORKERS_REFRESH_TUNING, stwrdFor } from "../../src/stwrd.js";

const BASE = { STWRD_BASE_URL: "https://app.example", STWRD_COOKIE_SECRET: "k".repeat(32), STWRD_SCOPE: "openid profile email offline_access org" };
const KEY = Buffer.alloc(32, 3).toString("base64url");

afterEach(() => vi.restoreAllMocks());

describe("WORKERS_REFRESH_TUNING", () => {
  it("probes the IdP, waits ten seconds at most, and polls 50, 100, 200, 400 then 800 ms", () => {
    expect(WORKERS_REFRESH_TUNING.probeBeforeExchange).toBe(true);
    expect(WORKERS_REFRESH_TUNING.waitS).toBe(10);
    expect(Array.from({ length: 9 }, (_, attempt) => WORKERS_REFRESH_TUNING.pollDelayMs(attempt))).toEqual([50, 100, 200, 400, 800, 800, 800, 800, 800]);
  });
});

/** A signed-in person whose access token expired, an IdP that can be taken down, and the way to ask for the session. */
async function scenario(make: (variables: Record<string, unknown>, fetch: FetchLike) => StwrdCore) {
  const idp = new FakeIdp({ clientId: "c1", clientSecret: "s1", redirectUri: "https://app.example/auth/callback", mode: "handler" });
  const issuer = await idp.start();
  let down = false;
  const calls: string[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${new URL(input).pathname}`);
    return down ? Promise.reject(new TypeError("fetch failed")) : idp.fetch(input, init);
  };
  const stwrd = make({ ...BASE, STWRD_ISSUER: issuer, STWRD_CLIENT_ID: "c1", STWRD_CLIENT_SECRET: "s1", STWRD_SESSION_KEYS: `k1:${KEY}`, STWRD_SESSIONS: workerEnv.STWRD_SESSIONS }, fetch);
  const code = idp.issueCode({ sub: "usr_1", withRefresh: true });
  const response = await stwrd.oidc.exchangeCode({ code, codeVerifier: "verifier" });
  const now = Date.now() / 1000;
  const id = `s-${crypto.randomUUID()}`;
  const session: StwrdSession = {
    id, sidIdp: null, sub: "usr_1", claims: { sub: "usr_1" },
    tokens: { access_token: response.access_token as string, id_token: response.id_token as string, token_type: "Bearer", refresh_token: response.refresh_token as string, expiresAt: now - 1 },
    expiresAt: now + 3600, accessExpiresAt: now - 1,
  };
  await stwrd.sessions.set(session);
  calls.length = 0;
  return { stwrd, idp, calls, cookie: stwrd.seal({ sid: id }), id, takeDown: () => (down = true), bringBack: () => (down = false) };
}

describe("an IdP that is down when the renewal starts", () => {
  it("costs a retry, not the session: nothing is marked sent and the next request renews", async () => {
    const s = await scenario((variables, fetch) => stwrdFor(variables, { fetch }));
    s.takeDown();
    await expect(s.stwrd.resolveSession(s.cookie)).rejects.toBeInstanceOf(IdpUnavailable);
    expect(s.calls).toEqual(["GET /.well-known/openid-configuration"]); // the probe, and nothing reached the token endpoint
    const lease = await s.stwrd.sessions.claimRefresh(s.id, "someone", 30);
    expect(lease).toMatchObject({ status: "granted", phase: "acquired" }); // not uncertain, not held
    if (lease.status === "granted") await s.stwrd.sessions.releaseRefresh(s.id, lease.fence, false);

    s.bringBack();
    s.calls.length = 0;
    expect(await s.stwrd.resolveSession(s.cookie)).not.toBeNull();
    expect(s.calls[0]).toBe("GET /.well-known/openid-configuration"); // probed again
    expect(s.calls).toContain("POST /oidc/token");
  });

  it("(control) without the probe the same outage ends in `uncertain`: this is what the probe is for", async () => {
    // The discovery is cached, the exchange fails after being marked as sent,
    // and workerd's fetch errors cannot prove it never left.
    const s = await scenario((variables, fetch) => {
      const core = new StwrdCore({ issuer: variables.STWRD_ISSUER as string, clientId: "c1", clientSecret: "s1", baseUrl: "https://app.example", cookieSecret: "k".repeat(32), scope: BASE.STWRD_SCOPE, fetch });
      return core;
    });
    s.takeDown();
    await expect(s.stwrd.resolveSession(s.cookie)).rejects.toBeInstanceOf(IdpUnavailable);
    expect(s.calls).toContain("POST /oidc/token");
    s.bringBack();
    const lease = await s.stwrd.sessions.claimRefresh(s.id, "someone", 30);
    expect(lease.status).toBe("uncertain");
  });
});

describe("waiting behind another owner's refresh", () => {
  it("polls 50, 100, 200, 400, 800 ms", async () => {
    const s = await scenario((variables, fetch) => stwrdFor(variables, { fetch, sessions: new MemoryStore() }));
    const lease = await s.stwrd.sessions.claimRefresh(s.id, "other-owner", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    const realGet = s.stwrd.sessions.get.bind(s.stwrd.sessions);
    let reads = 0;
    s.stwrd.sessions.get = async (id: string) => {
      reads += 1;
      if (reads === 6) { // the first read is `resolveSession`'s own: five waits
        const now = Date.now() / 1000;
        await s.stwrd.sessions.completeRefresh(id, lease.fence, { ...lease.session, tokens: { ...lease.session.tokens, expiresAt: now + 600 }, accessExpiresAt: now + 600 });
      }
      return realGet(id);
    };
    const spy = vi.spyOn(globalThis, "setTimeout");
    expect(await s.stwrd.resolveSession(s.cookie)).not.toBeNull();
    expect(spy.mock.calls.map((call) => call[1]).filter((delay) => typeof delay === "number" && delay < 1000)).toEqual([50, 100, 200, 400, 800]);
  }, 15_000);
});
