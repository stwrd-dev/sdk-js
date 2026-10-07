/**
 * The Express router is a shim over the core's `authHandler`. What the shim
 * itself owns — how a request enters the core and a response leaves it — is
 * pinned here: mounting, the `Host` header, an app's own global body parsers,
 * the body ceilings over a real socket, and `Set-Cookie` parity with Express.
 * Everything the routes answer is `router.test.ts` (unchanged) and the core's
 * own tests.
 */

import http from "node:http";

import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGOUT_EVENT_URI } from "@stwrd-auth/core/oidc";
import { clearedCookieHeader, setCookieHeader } from "@stwrd-auth/core/web/cookies";
import { createStwrd, signWebhook, type Stwrd } from "../../src/index.js";
import { FakeIdp } from "../fixtures/fakeIdp.js";
import { BASE_URL, CLIENT_ID, CLIENT_SECRET, withFakeIdp } from "./helpers.js";
import { CookieJar, TestServer, jarFetch } from "./testServer.js";

const make = (issuer: string, extra: Record<string, unknown> = {}): Stwrd =>
  createStwrd({
    issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, baseUrl: BASE_URL, cookieSecret: "x".repeat(32),
    scope: "openid profile email offline_access org", cookieSecure: false, fetch, ...extra,
  });

async function login(base: string, jar: CookieJar, idp: FakeIdp): Promise<string> {
  const signIn = await jarFetch(`${base}/auth/sign-in?return_to=/private`, { jar });
  const location = new URL(signIn.headers.get("location") as string);
  const code = idp.issueCode({ sub: "usr_1", nonce: location.searchParams.get("nonce"), userinfo: { email: "p@example.test", email_verified: true } });
  await jarFetch(`${base}/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar });
  return ((await (await jarFetch(`${base}/auth/session`, { jar })).json()) as { csrf_token: string }).csrf_token;
}

describe("Express shim", () => {
  let server: TestServer;
  let jar: CookieJar;
  beforeEach(() => {
    server = new TestServer();
    jar = new CookieJar();
  });
  afterEach(async () => {
    await server.stop();
  });

  describe("an app's own global body parsers ran before the router", () => {
    const PARSERS: Array<[string, (app: Express) => void]> = [
      ["express.urlencoded()", (app) => app.use(express.urlencoded({ extended: false }))],
      ["express.json()", (app) => app.use(express.json())],
      ["express.urlencoded() and express.json() both", (app) => { app.use(express.urlencoded({ extended: true })); app.use(express.json()); }],
    ];

    it.each(PARSERS)("%s: sign-out still reads its CSRF token from the form", async (_label, parsers) => {
      await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
        const stwrd = make(issuer);
        const app = express();
        parsers(app);
        app.use(stwrd.authRouter());
        const base = await server.start(app);
        const csrf = await login(base, jar, idp);

        const wrong = await jarFetch(`${base}/auth/sign-out`, {
          jar, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf_token: "nope" }).toString(),
        });
        expect(wrong.status).toBe(403);
        const right = await jarFetch(`${base}/auth/sign-out`, {
          jar, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf_token: csrf }).toString(),
        });
        expect(right.status).toBe(303);
      });
    });

    it("the back-channel still reads logout_token from the form, and /auth/organization its JSON", async () => {
      await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
        const stwrd = make(issuer);
        const app = express();
        app.use(express.urlencoded({ extended: false }));
        app.use(express.json());
        app.use(stwrd.authRouter());
        const base = await server.start(app);

        const now = Math.floor(Date.now() / 1000);
        const token = await idp.sign({ iss: issuer, aud: [CLIENT_ID], iat: now, exp: now + 120, jti: "j-global", sid: "s1", events: { [LOGOUT_EVENT_URI]: {} } });
        const delivered = await fetch(`${base}/auth/back-channel`, {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ logout_token: token }).toString(),
        });
        expect(delivered.status).toBe(200);

        const csrf = await login(base, jar, idp);
        const started = await jarFetch(`${base}/auth/organization`, {
          jar, method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ organization_id: "not-a-uuid" }),
        });
        expect(started.status).toBe(400);
        expect(await started.json()).toEqual({ detail: "Invalid organization_id." });
      });
    });

    it("a webhook whose body was parsed stays a 400 invalid_signature (the signature is over bytes)", async () => {
      await withFakeIdp({}, async (_idp, _fetchImpl, issuer) => {
        const stwrd = make(issuer, { webhookSecret: "whsec-x" });
        const app = express();
        app.use(express.json());
        app.use(stwrd.authRouter());
        const base = await server.start(app);
        const response = await fetch(`${base}/auth/webhook`, await signedDelivery("whsec-x"));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "invalid_signature" });
      });
    });

    it("a webhook behind express.raw() verifies, as before", async () => {
      await withFakeIdp({}, async (_idp, _fetchImpl, issuer) => {
        const stwrd = make(issuer, { webhookSecret: "whsec-x" });
        const app = express();
        app.use(express.raw({ type: () => true }));
        app.use(stwrd.authRouter());
        const base = await server.start(app);
        expect((await fetch(`${base}/auth/webhook`, await signedDelivery("whsec-x"))).status).toBe(200);
      });
    });
  });

  it("serves under a mount path and not outside it", async () => {
    await withFakeIdp({}, async (_idp, _fetchImpl, issuer) => {
      const app = express();
      app.use("/api", make(issuer).authRouter());
      const base = await server.start(app);
      expect((await fetch(`${base}/api/auth/session`)).status).toBe(200);
      expect((await fetch(`${base}/auth/session`)).status).toBe(404);
    });
  });

  it("falls through to the app for what is not a route: another path, the retired /auth/me, the wrong method", async () => {
    await withFakeIdp({}, async (_idp, _fetchImpl, issuer) => {
      const app = express();
      app.use(make(issuer).authRouter());
      app.get("/auth/own", (_req, res) => res.json({ own: true }));
      app.get("/hello", (_req, res) => res.json({ hello: true }));
      const base = await server.start(app);
      expect(await (await fetch(`${base}/hello`)).json()).toEqual({ hello: true });
      expect(await (await fetch(`${base}/auth/own`)).json()).toEqual({ own: true });
      expect((await fetch(`${base}/auth/me`)).status).toBe(404);
      expect((await fetch(`${base}/auth/sign-out`)).status).toBe(404);
      expect((await fetch(`${base}/auth/session`, { method: "DELETE" })).status).toBe(404);
    });
  });

  // `fetch` would normalize these before they leave, so they go out raw. The Express
  // router never served them; the URL parser used to rewrite them into /auth/session.
  it.each([
    "/auth/x/../session",
    "/auth/x/..\\session",
    "/auth/./session",
    "/auth/x/%2e%2e/session",
    "/auth/x/..%5csession",
    "/auth/x/../session?a=1",
  ])("does not serve %s: a path the URL parser would rewrite is the app's", async (path) => {
    await withFakeIdp({}, async (_idp, _fetchImpl, issuer) => {
      const app = express();
      app.use(make(issuer).authRouter());
      app.use((_req, res) => res.status(418).json({ app: true }));
      const base = await server.start(app);
      const status = await new Promise<number>((resolve, reject) => {
        const request = http.request(`${base}`, { path, method: "GET" }, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.on("error", reject);
        request.end();
      });
      expect(status).toBe(418);
      expect((await fetch(`${base}/auth/session`)).status).toBe(200);
    });
  });

  it("leaves the body of a request it does not serve to the app's own parser", async () => {
    await withFakeIdp({}, async (_idp, _fetchImpl, issuer) => {
      const app = express();
      app.use(make(issuer).authRouter());
      app.post("/echo", express.json(), (req, res) => res.json(req.body));
      app.post("/auth/session", express.json(), (req, res) => res.json({ app: req.body }));
      const base = await server.start(app);
      const send = (path: string) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
      expect(await (await send("/echo")).json()).toEqual({ a: 1 });
      // A POST on a GET route is the app's, body included.
      expect(await (await send("/auth/session")).json()).toEqual({ app: { a: 1 } });
    });
  });

  it("never takes the redirect_uri from the Host header", async () => {
    await withFakeIdp({}, async (_idp, _fetchImpl, issuer) => {
      const app = express();
      app.use(make(issuer).authRouter());
      const base = await server.start(app);
      const url = new URL(base);
      // `fetch` cannot set Host; speak HTTP by hand.
      const { request } = await import("node:http");
      const location = await new Promise<string>((resolve, reject) => {
        const req = request({ host: url.hostname, port: url.port, path: "/auth/sign-in", headers: { host: "evil.example" } }, (res) => {
          resolve(String(res.headers.location));
          res.resume();
        });
        req.on("error", reject);
        req.end();
      });
      expect(new URL(location).searchParams.get("redirect_uri")).toBe(`${BASE_URL}/auth/callback`);
      expect(location).not.toContain("evil.example");
    });
  });

  describe("the body ceilings over a real socket", () => {
    it.each([
      ["/auth/sign-out", "application/x-www-form-urlencoded", 100 * 1024],
      ["/auth/back-channel", "application/x-www-form-urlencoded", 100 * 1024],
      ["/auth/organization", "application/json", 100 * 1024],
      ["/auth/webhook", "application/json", 5 * 1024 * 1024],
    ])("%s answers 413 one byte over and keeps serving on the same server", async (path, contentType, limit) => {
      await withFakeIdp({}, async (_idp, _fetchImpl, issuer) => {
        const app = express();
        app.use(make(issuer).authRouter());
        const base = await server.start(app);
        const send = (size: number) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": contentType }, body: "a".repeat(size), redirect: "manual" });
        expect((await send(limit + 1)).status).toBe(413);
        expect((await send(limit)).status).not.toBe(413);
        expect((await fetch(`${base}/auth/session`)).status).toBe(200);
      });
    });
  });

  it("sends each Set-Cookie of the callback as its own header", async () => {
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const app = express();
      app.use(make(issuer).authRouter());
      const base = await server.start(app);
      const signIn = await jarFetch(`${base}/auth/sign-in`, { jar });
      const location = new URL(signIn.headers.get("location") as string);
      const code = idp.issueCode({ sub: "usr_1", nonce: location.searchParams.get("nonce") });
      const done = await jarFetch(`${base}/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar });
      expect(done.headers.getSetCookie()).toHaveLength(2);
    });
  });
});

describe("Set-Cookie parity with Express 4", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["a session cookie, https", "__Host-stwrd_session", "eyJzaWQiOiJhIn0.sig_-", 28800, true],
    ["a transaction cookie, http", "__Host-stwrd_tx", "payload.sig", 600, false],
    ["a value with characters that need escaping", "n", "a b;c=ñ/+", 1, true],
  ])("%s is byte for byte what res.cookie produced; the deletion adds Secure and Max-Age=0", async (_label, name, value, maxAgeS, secure) => {
    const app = express();
    app.get("/", (_req, res) => {
      res.cookie(name, value, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: maxAgeS * 1000 });
      // Express 4's `clearCookie` with the cookie's own attributes. Parity holds for everything
      // but the one thing changed on purpose (2026-10-07): the SDK's deletion also says
      // `Max-Age=0`, because a deletion without `Secure` is refused for a `__Host-` cookie.
      res.clearCookie(name, { httpOnly: true, secure, sameSite: "lax", path: "/" });
      res.end();
    });
    const server = new TestServer();
    const base = await server.start(app);
    try {
      vi.useFakeTimers({ now: new Date("2026-10-07T02:33:25Z"), toFake: ["Date"] });
      const response = await fetch(base);
      const [set, cleared] = response.headers.getSetCookie();
      expect(set).toBe(setCookieHeader(name, value, { maxAgeS, secure, nowMs: Date.parse("2026-10-07T02:33:25Z") }));
      // Express 4's deletion plus `Max-Age=0`, nothing else.
      expect(clearedCookieHeader(name, { secure })).toBe((cleared as string).replace("; Path=/", "; Max-Age=0; Path=/"));
    } finally {
      vi.useRealTimers();
      await server.stop();
    }
  });
});

async function signedDelivery(secret: string): Promise<RequestInit> {
  const id = "11111111-2222-4333-8444-555555555555";
  const body = JSON.stringify({ id, type: "user.created", api_version: "v1", created_at: "2026-01-01T00:00:00Z", data: {} });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signWebhook(secret, { eventId: id, timestamp, body }) },
    body,
  };
}
