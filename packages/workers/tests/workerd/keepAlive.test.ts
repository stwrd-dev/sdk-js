// A person who closes the tab while their session is being renewed must not
// cost them the session. workerd cancels what a request started once the
// client is gone, unless it was handed to `ctx.waitUntil`; a renewal cut between
// "marked sent" and "saved" leaves the session `uncertain` for good. The Worker
// entry points take the `ExecutionContext` and keep the renewal alive with it.
//
// NOT VERIFIED on real Cloudflare: here the runtime is modelled (a fake `ctx`
// that records `waitUntil`, and a token endpoint that is cut for an aborted
// request nobody held). That workerd really cancels, and that `waitUntil`
// really prevents it, is the platform's documented behaviour, not something
// this test can observe.
import { env as workerEnv } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { ConfigError } from "@stwrd-auth/core/config";
import type { FetchLike } from "@stwrd-auth/core/oidc";
import type { StwrdSession } from "@stwrd-auth/core/sessions";
import { FakeIdp } from "../../../node/tests/fixtures/fakeIdp.js";
import { type StwrdWorkers, type WaitUntilContext, stwrdFor } from "../../src/stwrd.js";

const KEY = Buffer.alloc(32, 5).toString("base64url");

/** A Worker, a signed-in person whose access token expired, and a model of the runtime. */
async function scenario() {
  const idp = new FakeIdp({ clientId: "c1", clientSecret: "s1", redirectUri: "https://app.example/auth/callback", mode: "handler" });
  const issuer = await idp.start();
  const held: Promise<unknown>[] = [];
  const ctx: WaitUntilContext = { waitUntil: (work) => void held.push(work) };
  let aborted = false;
  let reached!: () => void;
  let release!: () => void;
  const atTokenEndpoint = new Promise<void>((resolve) => (reached = resolve));
  const open = new Promise<void>((resolve) => (release = resolve));
  const fetch: FetchLike = async (input, init) => {
    if (input.endsWith("/oidc/token") && String(init?.body).includes("grant_type=refresh_token")) {
      reached();
      await open;
      // The client is gone: workerd cancels the subrequests of a request that
      // nothing asked to keep alive.
      if (aborted && held.length === 0) throw new TypeError("The request was cancelled because the client disconnected");
    }
    return idp.fetch(input, init);
  };
  const stwrd = stwrdFor(
    { STWRD_ISSUER: issuer, STWRD_CLIENT_ID: "c1", STWRD_CLIENT_SECRET: "s1", STWRD_BASE_URL: "https://app.example", STWRD_COOKIE_SECRET: "k".repeat(32), STWRD_SCOPE: "openid profile email offline_access org", STWRD_SESSION_KEYS: `k1:${KEY}`, STWRD_SESSIONS: workerEnv.STWRD_SESSIONS },
    { fetch },
  );
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
  const request = (path: string) => new Request(`https://app.example${path}`, { headers: { cookie: `${stwrd.config.sessionCookie}=${stwrd.seal({ sid: id })}`, accept: "application/json" } });
  /** The person closes the tab: the exchange is in flight, then the client goes. */
  const closeTabMidRenewal = async (pending: Promise<unknown>) => {
    await atTokenEndpoint;
    aborted = true;
    release();
    await pending.catch(() => undefined); // what the dropped request does is nobody's business
    await Promise.allSettled(held); // what the runtime lets finish after the response
  };
  return { stwrd, idp, ctx, held, id, request, closeTabMidRenewal };
}

type EntryPoint = (stwrd: StwrdWorkers, request: Request, ctx?: WaitUntilContext) => Promise<unknown>;
const ENTRY_POINTS: [string, string, EntryPoint][] = [
  ["handle", "/auth/session", (s, r, ctx) => s.handle(r, ctx)],
  ["resolve", "/private", (s, r, ctx) => s.resolve(r, ctx)],
  ["protect", "/private", (s, r, ctx) => s.protect(r, { ctx })],
  ["requireAuth", "/private", (s, r, ctx) => s.requireAuth(r, { ctx })],
  ["requireRole", "/private", (s, r, ctx) => s.requireRole(r, "any", { ctx })],
  ["requirePermission", "/private", (s, r, ctx) => s.requirePermission(r, "any", { ctx })],
  ["requireOrg", "/private", (s, r, ctx) => s.requireOrg(r, { ctx })],
];

describe("a tab closed in the middle of a renewal", () => {
  it.each(ENTRY_POINTS)("%s with the ctx: hands the renewal to ctx.waitUntil once, before the exchange is answered", async (_name, path, call) => {
    const s = await scenario();
    await s.closeTabMidRenewal(call(s.stwrd, s.request(path), s.ctx));
    expect(s.held).toHaveLength(1);
    expect(s.idp.refreshCalls.length).toBe(1);
    const stored = await s.stwrd.sessions.get(s.id);
    expect(stored && stored.accessExpiresAt > Date.now() / 1000).toBe(true); // saved
    expect((await s.stwrd.sessions.claimRefresh(s.id, "next", 30)).status).toBe("granted");
  });

  it("(control) without the ctx the same abort leaves the session `uncertain`: this is what the ctx is for", async () => {
    const s = await scenario();
    await s.closeTabMidRenewal(s.stwrd.handle(s.request("/auth/session")));
    expect(s.held).toHaveLength(0);
    expect((await s.stwrd.sessions.claimRefresh(s.id, "next", 30)).status).toBe("uncertain");
  });
});

describe("the ctx when nothing needs renewing", () => {
  it("is not touched by a request whose session is fresh, nor by one with no session", async () => {
    const s = await scenario();
    const now = Date.now() / 1000;
    const current = (await s.stwrd.sessions.get(s.id)) as StwrdSession;
    await s.stwrd.sessions.set({ ...current, accessExpiresAt: now + 600, tokens: { ...current.tokens, expiresAt: now + 600 } });
    await s.stwrd.handle(s.request("/auth/session"), s.ctx);
    await s.stwrd.protect(s.request("/private"), { ctx: s.ctx });
    await s.stwrd.handle(new Request("https://app.example/auth/session"), s.ctx);
    expect(s.held).toHaveLength(0);
  });
});

describe("a ctx that cannot waitUntil", () => {
  // The usual slip: `env` passed where the Worker's `ctx` goes.
  const wrong: [string, unknown][] = [
    ["env instead of ctx", { STWRD_SESSIONS: workerEnv.STWRD_SESSIONS }],
    ["a ctx whose waitUntil is not a function", { waitUntil: "later" }],
    ["null", null],
  ];

  it.each(ENTRY_POINTS.flatMap(([name, path, call]) => wrong.map(([what, ctx]) => [name, what, path, call, ctx] as const)))(
    "%s with %s is a ConfigError before the lease is asked for",
    async (_name, _what, path, call, ctx) => {
      const s = await scenario();
      const claim = vi.spyOn(s.stwrd.sessions, "claimRefresh");
      await expect(call(s.stwrd, s.request(path), ctx as WaitUntilContext)).rejects.toThrow(ConfigError);
      await expect(call(s.stwrd, s.request(path), ctx as WaitUntilContext)).rejects.toThrow(/ExecutionContext/);
      expect(claim).not.toHaveBeenCalled();
      expect(s.idp.refreshCalls.length).toBe(0);
    },
  );

  it("protect says so even for a public path, which would never have read the session", async () => {
    const s = await scenario();
    await expect(s.stwrd.protect(s.request("/health"), { public: ["/health"], ctx: {} as WaitUntilContext })).rejects.toThrow(ConfigError);
  });
});
