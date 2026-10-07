// The eight `/auth/*` routes as `Request → Response`, driven with no Express
// and no socket, on Node and on workerd. The Express router of `@stwrd-auth/node`
// is a shim over this handler, so what is pinned here is what every adapter
// serves: same routes, same JSON, same cookies, same refusals.
import { describe, expect, it } from "vitest";

import type { StwrdCore } from "../../src/client.js";
import { HEADER_ID, HEADER_SIGNATURE, HEADER_TIMESTAMP, signWebhook } from "../../src/webhooks.js";
import { IDP_SILENT, checkAccess, isPublicPath, type AccessRule } from "../../src/web/access.js";
import { type CallInit, Jar, driver, login, request } from "../support/authDriver.js";
import { BASE_URL, ISSUER, newStwrd } from "../support/inProcessIdp.js";

// The ceilings are the contract (the Express router had 100kb and 5mb): written out here, not read from the code.
const FORM_LIMIT_BYTES = 102400;
const WEBHOOK_LIMIT_BYTES = 5242880;
const SESSION_COOKIE = "__Host-stwrd_session";
const TX_COOKIE = "__Host-stwrd_tx";
const DATE = "[A-Z][a-z]{2}, \\d{2} [A-Z][a-z]{2} \\d{4} \\d{2}:\\d{2}:\\d{2} GMT";
const SEALED = "[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+";
const ADMIN = { org_id: "o1", org_display_name: "Team", org_roles: ["org:admin"], org_permissions: ["members:invite"] };

const form = (values: Record<string, string>): CallInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
});

async function loggedIn(extra: Record<string, unknown> = {}, loginOptions: Parameters<typeof login>[3] = {}) {
  const { idp, stwrd } = await newStwrd(extra);
  const { call, handle } = driver(stwrd);
  const jar = new Jar();
  const response = await login(call, jar, idp, loginOptions);
  expect(response.status).toBe(303);
  const csrf = ((await (await call("/auth/session", { jar })).json()) as { csrf_token: string }).csrf_token;
  const sessionId = (stwrd.unseal(jar.get(SESSION_COOKIE)) as { sid: string }).sid;
  return { idp, stwrd, call, handle, jar, csrf, sessionId };
}

/** Leaves the session with an expired access token and a refresh token: the
 * next request has to go to the IdP, which is then silent. */
async function dueForRenewal(stwrd: StwrdCore, sessionId: string): Promise<void> {
  const stored = await stwrd.sessions.get(sessionId);
  if (!stored) throw new Error("no session to age");
  const past = Date.now() / 1000 - 1;
  await stwrd.sessions.set({ ...stored, tokens: { ...stored.tokens, expiresAt: past, refresh_token: "rt-nobody-will-read" }, accessExpiresAt: past });
}

describe("which requests the handler serves", () => {
  it.each([
    ["another path", "GET", "/private"],
    ["the retired /auth/me", "GET", "/auth/me"],
    ["an unknown route under the prefix", "GET", "/auth/nope"],
    ["GET on a POST route", "GET", "/auth/sign-out"],
    ["POST on a GET route", "POST", "/auth/session"],
    ["DELETE on a route", "DELETE", "/auth/session"],
    ["the prefix itself", "GET", "/auth"],
    ["a prefix lookalike", "GET", "/authx/session"],
  ])("answers null for %s, so the app routes it", async (_label, method, path) => {
    const { stwrd } = await newStwrd();
    expect(await driver(stwrd).handle(request(path, { method }))).toBeNull();
  });

  it.each([
    ["a trailing slash", "GET", "/auth/session/"],
    ["upper case", "GET", "/AUTH/Session"],
    ["HEAD on a GET route", "HEAD", "/auth/session"],
  ])("serves %s, the way an Express router matches", async (_label, method, path) => {
    const { stwrd } = await newStwrd();
    const response = await driver(stwrd).handle(request(path, { method }));
    expect(response?.status).toBe(200);
  });

  it("follows a custom prefix", async () => {
    const { stwrd } = await newStwrd({ prefix: "/sso" });
    const { handle } = driver(stwrd);
    expect((await handle(request("/sso/session")))?.status).toBe(200);
    expect(await handle(request("/auth/session"))).toBeNull();
  });
});

describe("the cookies the routes set", () => {
  it("sign-in: the transaction cookie, in the exact shape", async () => {
    const { stwrd } = await newStwrd();
    const response = await driver(stwrd).call("/auth/sign-in?return_to=/private");
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]).toMatch(
      new RegExp(`^${TX_COOKIE}=${SEALED}; Max-Age=600; Path=/; Expires=${DATE}; HttpOnly; Secure; SameSite=Lax$`),
    );
  });

  it("callback: a deletion of the transaction cookie, then the session cookie", async () => {
    const { idp, stwrd } = await newStwrd();
    const { call } = driver(stwrd);
    const jar = new Jar();
    const response = await login(call, jar, idp);
    const [cleared, session] = response.headers.getSetCookie();
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(cleared).toBe(`${TX_COOKIE}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`);
    expect(session).toMatch(new RegExp(`^${SESSION_COOKIE}=${SEALED}; Max-Age=28800; Path=/; Expires=${DATE}; HttpOnly; Secure; SameSite=Lax$`));
    // Both reach the browser as separate headers, never one comma-joined value.
    expect(response.headers.get("location")).toBe("/private");
  });

  it("sign-out: a deletion of the session cookie", async () => {
    const { call, jar, csrf } = await loggedIn();
    const response = await call("/auth/sign-out", { ...form({ csrf_token: csrf }), jar });
    expect(response.headers.getSetCookie()).toEqual([
      // `Secure` and `Max-Age=0`: a browser refuses to delete a `__Host-` cookie without `Secure`.
      `${SESSION_COOKIE}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`,
    ]);
  });

  it("drops Secure only when the app says it serves plain http", async () => {
    const { stwrd } = await newStwrd({ cookieSecure: false, sessionTtlS: 120, transactionTtlS: 30 });
    const response = await driver(stwrd).call("/auth/sign-in");
    expect(response.headers.getSetCookie()[0]).toMatch(new RegExp(`^${TX_COOKIE}=${SEALED}; Max-Age=30; Path=/; Expires=${DATE}; HttpOnly; SameSite=Lax$`));
  });
});

describe("sign-in", () => {
  it("goes to the authorize endpoint with PKCE and a sealed transaction", async () => {
    const { stwrd } = await newStwrd();
    const response = await driver(stwrd).call("/auth/sign-in?return_to=/private");
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/oidc/authorize`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/auth/callback`);
  });

  it.each([
    ["hint=ana%40example.test&ui_locales=es"],
    ["prompt=none&max_age=0&scope=admin&acr_values=2"],
    ["organization_id=00000000-0000-4000-8000-000000000000&next=%2Felsewhere"],
  ])("reads only the destination: %s reaches nothing in the authorize request", async (extra) => {
    const { stwrd } = await newStwrd();
    const { call } = driver(stwrd);
    const sent = async (query: string) => new URL((await call(`/auth/sign-in?${query}`)).headers.get("location") as string).searchParams;
    const baseline = await sent("return_to=/private");
    // Negative control: the baseline is a real authorize request, so a leaked
    // parameter changes the key set and fails the comparison below.
    for (const key of ["state", "nonce", "code_challenge", "scope"]) {
      expect(baseline.has(key)).toBe(true);
    }
    const params = await sent(`return_to=/private&${extra}`);
    expect([...params.keys()].sort()).toEqual([...baseline.keys()].sort());
    expect(params.get("scope")).toBe(baseline.get("scope"));
  });

  it("with a live session goes straight to return_to", async () => {
    const { call, jar } = await loggedIn();
    const response = await call("/auth/sign-in?return_to=/x", { jar });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/x");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("answers 503 text when the IdP is silent", async () => {
    const { idp, stwrd } = await newStwrd();
    idp.silent = true;
    const response = await driver(stwrd).call("/auth/sign-in");
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(IDP_SILENT);
  });

  it("is the way out of an uncertain refresh: the session answers 503, sign-in starts a new login", async () => {
    const { stwrd, call, jar, sessionId } = await loggedIn();
    await dueForRenewal(stwrd, sessionId);
    const lease = await stwrd.sessions.claimRefresh(sessionId, "dead-worker", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    await stwrd.sessions.markRefreshSent(sessionId, lease.fence);
    await stwrd.sessions.releaseRefresh(sessionId, lease.fence, true); // outcome unknown

    expect((await call("/auth/session", { jar })).status).toBe(503);
    const started = await call("/auth/sign-in?return_to=/private", { jar });
    expect(started.status).toBe(303);
    expect(started.headers.get("location")).toContain(`${ISSUER}/oidc/authorize`);
  });
});

// Every SDK confines `return_to` identically.
const RETURN_TO_TABLE: Array<[string, string]> = [
  ["/private", "/private"],
  ["/", "/"],
  ["/a/b?c=1&d=2", "/a/b?c=1&d=2"],
  ["/a#frag", "/a#frag"],
  ["/@evil", "/@evil"],
  ["https://evil.example/", "/"],
  ["http://evil.example", "/"],
  ["//evil.example", "/"],
  ["//evil.example/path", "/"],
  ["/\\evil.example", "/"],
  ["javascript:alert(1)", "/"],
  ["@evil.example", "/"],
  ["evil.example", "/"],
  ["private", "/"],
  ["", "/"],
  ["/café ñ", "/caf%C3%A9%20%C3%B1"],
];

describe("return_to never leaves the origin", () => {
  it.each(RETURN_TO_TABLE)("%j → %j with a session, through the transaction, and sealed", async (candidate, expected) => {
    const { idp, stwrd } = await newStwrd();
    const { call } = driver(stwrd);

    // The destination travels sealed in the transaction and is honoured after the callback.
    const jar = new Jar();
    const done = await login(call, jar, idp, { returnTo: candidate });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(expected);

    // With a session already, sign-in only redirects within this origin.
    const again = await call(`/auth/sign-in?return_to=${encodeURIComponent(candidate)}`, { jar });
    expect(again.headers.get("location")).toBe(expected);

    // A target that got into the sealed transaction unchecked is confined at the callback too.
    const fresh = new Jar();
    const signIn = await call("/auth/sign-in", { jar: fresh });
    const tx = stwrd.unseal(fresh.get(TX_COOKIE)) as Record<string, unknown>;
    fresh.set(TX_COOKIE, stwrd.seal({ ...tx, return_to: candidate }));
    const location = new URL(signIn.headers.get("location") as string);
    const code = idp.issueCode({ nonce: location.searchParams.get("nonce") });
    const forged = await call(`/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar: fresh });
    expect(forged.headers.get("location")).toBe(expected);
  });
});

describe("callback", () => {
  it("opens a session and tells the app who registered", async () => {
    const { idp, stwrd } = await newStwrd();
    const seen: unknown[] = [];
    const { call } = driver(stwrd, { onUserRegistered: (user) => void seen.push(user) });
    const jar = new Jar();
    await login(call, jar, idp);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: "usr_1", email: "persona@example.test" });
    expect((await (await call("/auth/session", { jar })).json()) as { authenticated: boolean }).toMatchObject({ authenticated: true });
  });

  it.each([
    ["no transaction cookie", "/auth/callback?code=x&state=y", 400],
    ["a state that does not match", "state-mismatch", 400],
  ])("rejects %s", async (_label, path, status) => {
    const { stwrd } = await newStwrd();
    const { call } = driver(stwrd);
    const jar = new Jar();
    if (path === "state-mismatch") {
      await call("/auth/sign-in", { jar });
      expect((await call("/auth/callback?code=x&state=not-it", { jar })).status).toBe(status);
    } else {
      expect((await call(path, { jar })).status).toBe(status);
    }
  });

  it("a rejected code is 400, a silent IdP is 503 (a login that could not be tried was not rejected)", async () => {
    const { idp, stwrd } = await newStwrd();
    const { call } = driver(stwrd);
    const jar = new Jar();
    const signIn = await call("/auth/sign-in", { jar });
    const state = new URL(signIn.headers.get("location") as string).searchParams.get("state");
    expect((await call(`/auth/callback?code=unknown&state=${state}`, { jar })).status).toBe(400);
    const second = new Jar();
    await call("/auth/sign-in", { jar: second });
    const secondState = (stwrd.unseal(second.get(TX_COOKIE)) as { state: string }).state;
    idp.silent = true;
    const response = await call(`/auth/callback?code=whatever&state=${secondState}`, { jar: second });
    expect(response.status).toBe(503);
  });

  it("lets a store that is down surface as an error instead of a half-made login", async () => {
    const { idp, stwrd } = await newStwrd();
    stwrd.sessions.set = async () => {
      throw new Error("store down");
    };
    const { call, handle } = driver(stwrd);
    const jar = new Jar();
    const signIn = await call("/auth/sign-in", { jar });
    const location = new URL(signIn.headers.get("location") as string);
    const code = idp.issueCode({ nonce: location.searchParams.get("nonce") });
    await expect(handle(request(`/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar }))).rejects.toThrow("store down");
  });
});

describe("GET /auth/session", () => {
  it("has the same shape with and without a session, never cached", async () => {
    const { idp, stwrd } = await newStwrd();
    const { call } = driver(stwrd);
    const anonymous = await call("/auth/session");
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    expect(anonymous.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await anonymous.json()).toEqual({
      authenticated: false, user: null, organization: null, consents: {}, csrf_token: null, account_url: `${ISSUER}/me`,
    });
    const jar = new Jar();
    await login(call, jar, idp, { userinfo: { consents: { terms: "accepted" } } });
    const body = (await (await call("/auth/session", { jar })).json()) as Record<string, any>;
    expect(Object.keys(body).sort()).toEqual(["account_url", "authenticated", "consents", "csrf_token", "organization", "user"]);
    expect(Object.keys(body.user).sort()).toEqual(["avatar_url", "display_name", "email", "email_verified", "id", "permissions", "roles"]);
    expect(body.consents).toEqual({ terms: "accepted" });
  });
});

describe("POST /auth/sign-out", () => {
  it("with no session redirects without asking for CSRF", async () => {
    const { stwrd } = await newStwrd();
    const response = await driver(stwrd).call("/auth/sign-out", { method: "POST" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${BASE_URL}/`);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  const FORGERIES: Array<[string, (valid: string) => string | null]> = [
    ["absent", () => null],
    ["empty", () => ""],
    ["wrong, same length", (valid) => `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`],
    ["shorter than the real one", (valid) => valid.slice(0, -1)],
    ["longer than the real one", (valid) => `${valid}x`],
    ["non-ASCII", () => "csrf-ü"],
  ];

  it.each(FORGERIES)("rejects a CSRF token that is %s, keeps the session, in the form and in the header", async (_label, forge) => {
    const { call, jar, csrf, sessionId, stwrd } = await loggedIn();
    const forged = forge(csrf);
    const inForm = await call("/auth/sign-out", { ...form(forged === null ? {} : { csrf_token: forged }), jar });
    expect(inForm.status).toBe(403);
    expect(await inForm.json()).toEqual({ detail: "Invalid CSRF token." });
    const inHeader = await call("/auth/sign-out", { method: "POST", headers: forged === null ? {} : { "x-csrf-token": forged }, jar });
    expect(inHeader.status).toBe(403);
    expect(await stwrd.sessions.get(sessionId)).not.toBeNull();
  });

  it.each([
    ["the header", (csrf: string): CallInit => ({ method: "POST", headers: { "x-csrf-token": csrf } })],
    ["the form", (csrf: string): CallInit => form({ csrf_token: csrf })],
  ])("ends the session with a valid token in %s", async (_label, withToken) => {
    const { call, jar, csrf, sessionId, stwrd } = await loggedIn();
    const response = await call("/auth/sign-out", { ...withToken(csrf), jar });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${BASE_URL}/`);
    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
    expect(await stwrd.sessions.get(sessionId)).toBeNull();
  });

  it("goes to end_session when the IdP advertises it", async () => {
    const { idp, stwrd } = await newStwrd();
    idp.advertiseEndSession = true;
    const { call } = driver(stwrd);
    const jar = new Jar();
    await login(call, jar, idp);
    const csrf = ((await (await call("/auth/session", { jar })).json()) as { csrf_token: string }).csrf_token;
    const response = await call("/auth/sign-out", { method: "POST", headers: { "x-csrf-token": csrf }, jar });
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/oidc/end-session`);
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe(`${BASE_URL}/`);
    expect(location.searchParams.get("id_token_hint")).toBeTruthy();
  });
});

describe("request bodies", () => {
  const at = (size: number) => "a".repeat(size);
  const stream = (chunks: number, chunkSize: number, onPull: () => void) =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        onPull();
        controller.enqueue(new Uint8Array(chunkSize).fill(97));
        if (--chunks === 0) controller.close();
      },
    });

  it.each([
    ["POST /auth/sign-out (form)", "/auth/sign-out", "application/x-www-form-urlencoded", FORM_LIMIT_BYTES, 303],
    ["POST /auth/organization (JSON)", "/auth/organization", "application/json", FORM_LIMIT_BYTES, 401],
    ["POST /auth/back-channel (form)", "/auth/back-channel", "application/x-www-form-urlencoded", FORM_LIMIT_BYTES, 400],
    ["POST /auth/webhook", "/auth/webhook", "application/json", WEBHOOK_LIMIT_BYTES, 503],
  ])("%s: 413 one byte over the ceiling, served at the ceiling", async (_label, path, contentType, limit, atLimit) => {
    const { stwrd } = await newStwrd();
    const { call } = driver(stwrd);
    const send = (size: number) =>
      call(path, { method: "POST", headers: { "content-type": contentType }, body: contentType === "application/json" ? `"${at(size - 2)}"` : at(size) });
    const over = await send(limit + 1);
    expect(over.status).toBe(413);
    const ok = await send(limit);
    // At the ceiling the body is read and the route answers as it would for any
    // body (a JSON string is not an object: 400 for /auth/organization).
    expect([atLimit, 400]).toContain(ok.status);
  });

  it.each([
    ["/auth/sign-out", "k&".repeat(51200)],
    ["/auth/back-channel", "k&".repeat(51200)],
    ["/auth/organization", "k&".repeat(51200)],
    ["/auth/sign-out", Array.from({ length: 1001 }, (_, i) => `k${i}=v`).join("&")],
  ])("%s: more than 1000 form fields is a 413, quickly (Express parameterLimit, Python max_fields)", async (path, text) => {
    const { stwrd } = await newStwrd();
    const started = Date.now();
    const response = await driver(stwrd).call(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: text });
    expect(response.status).toBe(413);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("measures the stream, not Content-Length: it stops reading once the ceiling is crossed", async () => {
    const { stwrd } = await newStwrd();
    const { handle } = driver(stwrd);
    let pulls = 0;
    const body = stream(1000, 64 * 1024, () => (pulls += 1));
    const req = new Request(`${BASE_URL}/auth/webhook`, { method: "POST", body, duplex: "half" } as RequestInit);
    const response = await handle(req);
    expect(response?.status).toBe(413);
    // 5 MiB is 80 chunks of 64 KiB; the 1000-chunk stream was not read to its end.
    expect(pulls).toBeLessThan(200);
  });

  it("a body somebody already consumed reads as empty: the webhook is an invalid signature, the form carries no token", async () => {
    const { call, jar, csrf, stwrd } = await loggedIn({ webhookSecret: "whsec-x" });
    const { handle } = driver(stwrd);

    const webhook = request("/auth/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await webhook.arrayBuffer();
    expect((await handle(webhook))?.status).toBe(400);

    const signOut = request("/auth/sign-out", { ...form({ csrf_token: csrf }), jar });
    await signOut.arrayBuffer();
    expect((await handle(signOut))?.status).toBe(403);
    // The same request, unconsumed, passes: the 403 above is the consumed body.
    expect((await call("/auth/sign-out", { ...form({ csrf_token: csrf }), jar })).status).toBe(303);
  });

  it("a JSON body that is not JSON is a 400, not a crash", async () => {
    const { stwrd } = await newStwrd();
    const response = await driver(stwrd).call("/auth/organization", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(response.status).toBe(400);
  });
});

describe("back-channel logout", () => {
  async function withSession(sid: string) {
    const { idp, stwrd } = await newStwrd();
    const sessionId = stwrd.sessionIdForSid(sid);
    const now = Date.now() / 1000;
    await stwrd.sessions.set({
      id: sessionId, sidIdp: sid, sub: "user-1", claims: { sub: "user-1", sid },
      tokens: { access_token: "a", id_token: "i", token_type: "Bearer", expiresAt: now + 600 }, expiresAt: now + 600, accessExpiresAt: now + 600,
    });
    const { call } = driver(stwrd);
    const deliver = async (token: string) => call("/auth/back-channel", form({ logout_token: token }));
    return { idp, stwrd, sessionId, deliver };
  }

  it("ends the local session and refuses a replay", async () => {
    const { idp, stwrd, sessionId, deliver } = await withSession("s-alive");
    const token = await idp.logoutToken({ sid: "s-alive", jti: "j1" });
    const first = await deliver(token);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ status: "ok" });
    expect(await stwrd.sessions.get(sessionId)).toBeNull();
    const replay = await deliver(token);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "replay" });
  });

  it("a failed deletion leaves the jti unseen, so the IdP's retry still ends the session", async () => {
    // The IdP retries a 5xx and not a 4xx: if the `jti` were marked before the
    // deletion, the retry would be a 400 "replay" and the session would stay
    // alive for good.
    const { idp, stwrd, sessionId, deliver } = await withSession("s-retry");
    const realDelete = stwrd.sessions.delete.bind(stwrd.sessions);
    let failures = 1;
    stwrd.sessions.delete = async (id: string) => {
      if (failures-- > 0) throw new Error("store down");
      return realDelete(id);
    };
    const token = await idp.logoutToken({ sid: "s-retry", jti: "j-retry" });
    await expect(deliver(token)).rejects.toThrow("store down");
    expect(await stwrd.sessions.get(sessionId)).not.toBeNull();
    expect((await deliver(token)).status).toBe(200);
    expect(await stwrd.sessions.get(sessionId)).toBeNull();
    expect((await deliver(token)).status).toBe(400);
  });

  it.each([
    ["no token", form({})],
    ["an empty token", form({ logout_token: "" })],
    ["a token that is not a JWT", form({ logout_token: "garbage" })],
  ])("answers 400 to %s", async (_label, init) => {
    const { stwrd } = await newStwrd();
    const response = await driver(stwrd).call("/auth/back-channel", init);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503, not 400, when the IdP's keys cannot be fetched: a 4xx would lose the notice for good", async () => {
    const { idp, deliver } = await withSession("s-mute");
    const token = await idp.logoutToken({ sid: "s-mute", jti: "j-mute" });
    idp.silent = true;
    const response = await deliver(token);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "idp_unavailable" });
  });

  it("uses the sink it is given", async () => {
    const { idp, stwrd } = await newStwrd();
    const calls: unknown[][] = [];
    const { call } = driver(stwrd, {
      backChannel: { terminate: async (...args) => (calls.push(args), "replay" as const) },
    });
    const response = await call("/auth/back-channel", form({ logout_token: await idp.logoutToken({ sid: "s9", jti: "j9" }) }));
    expect(response.status).toBe(400);
    expect(calls).toEqual([[stwrd.sessionIdForSid("s9"), "j9", expect.any(Number)]]);
  });
});

describe("POST /auth/webhook", () => {
  const EVENT_ID = "11111111-2222-4333-8444-555555555555";
  const delivery = (secret: string, id = EVENT_ID) => {
    const body = JSON.stringify({ id, type: "user.created", api_version: "v1", created_at: "2026-01-01T00:00:00Z", data: {} });
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      method: "POST",
      headers: { "content-type": "application/json", [HEADER_ID]: id, [HEADER_TIMESTAMP]: timestamp, [HEADER_SIGNATURE]: signWebhook(secret, { eventId: id, timestamp, body }) },
      body,
    };
  };

  it("is 503 without a secret, 400 with a bad signature", async () => {
    const none = await newStwrd();
    const response = await driver(none.stwrd).call("/auth/webhook", { method: "POST", body: "{}" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "webhook_not_configured" });

    const { stwrd } = await newStwrd({ webhookSecret: "whsec-x" });
    const bad = await driver(stwrd).call("/auth/webhook", delivery("another-secret"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_signature" });
  });

  it("accepts a signed delivery once, hands it to onEvent, and answers duplicate to the second", async () => {
    const { stwrd } = await newStwrd({ webhookSecret: "whsec-x" });
    const events: Array<{ id: string }> = [];
    const { call } = driver(stwrd, { onEvent: (event) => void events.push(event) });
    const first = await call("/auth/webhook", delivery("whsec-x"));
    expect(await first.json()).toEqual({ status: "ok" });
    expect(await (await call("/auth/webhook", delivery("whsec-x"))).json()).toEqual({ status: "duplicate" });
    expect(events.map((event) => event.id)).toEqual([EVENT_ID]);
  });
});

describe("organization selection", () => {
  const ORG_A = "11111111-1111-4111-8111-111111111111";
  const ORG_B = "22222222-2222-4222-8222-222222222222";
  const own = (id: string, name: string) => ({ organization: { id, display_name: name }, active: true });

  it("is a 404 unless the org scope was requested", async () => {
    const { stwrd } = await newStwrd({ scope: "openid profile email" });
    const { call } = driver(stwrd);
    expect((await call("/auth/organizations")).status).toBe(404);
    expect((await call("/auth/organization", { method: "POST" })).status).toBe(404);
  });

  it("lists the person's organizations, and asks for a session first", async () => {
    const { idp, call, jar } = await loggedIn();
    expect((await call("/auth/organizations")).status).toBe(401);
    idp.memberships = [own(ORG_A, "Org A"), own(ORG_B, "Org B")];
    const response = await call("/auth/organizations", { jar });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ organizations: [
      { id: ORG_A, display_name: "Org A", current: false }, { id: ORG_B, display_name: "Org B", current: false },
    ] });
  });

  it("checks session, CSRF, the id's shape and ownership before it starts a login, then starts one", async () => {
    const { idp, call, jar, csrf } = await loggedIn();
    idp.memberships = [own(ORG_A, "Org A")];
    const json = (body: unknown, token: string | null = csrf, withJar = true): CallInit => ({
      method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-csrf-token": token } : {}) },
      body: JSON.stringify(body), ...(withJar ? { jar } : {}),
    });
    expect((await call("/auth/organization", json({ organization_id: ORG_A }, csrf, false))).status).toBe(401);
    expect((await call("/auth/organization", json({ organization_id: ORG_A }, null))).status).toBe(403);
    expect((await call("/auth/organization", json({ organization_id: ORG_A }, "wrong"))).status).toBe(403);
    expect((await call("/auth/organization", json({ organization_id: "not-a-uuid" }))).status).toBe(400);
    expect((await call("/auth/organization", json({ organization_id: ORG_B }))).status).toBe(404);

    const started = await call("/auth/organization", json({ organization_id: ORG_A.toUpperCase(), return_to: "//evil.example" }));
    expect(started.status).toBe(303);
    expect(new URL(started.headers.get("location") as string).searchParams.get("organization_id")).toBe(ORG_A);
    expect(started.headers.getSetCookie()[0]).toMatch(new RegExp(`^${TX_COOKIE}=`));

    // The same through a form.
    const viaForm = await call("/auth/organization", { ...form({ organization_id: ORG_A, csrf_token: csrf }), jar });
    expect(viaForm.status).toBe(303);
  });

  it("the callback replaces the live session only when the callback matches the selection exactly", async () => {
    const { idp, stwrd, call, jar, csrf, sessionId } = await loggedIn();
    idp.memberships = [own(ORG_A, "Org A")];
    const start = () =>
      call("/auth/organization", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ organization_id: ORG_A }), jar });
    const finish = (started: Response, claims: Record<string, unknown>) => {
      const location = new URL(started.headers.get("location") as string);
      const code = idp.issueCode({ nonce: location.searchParams.get("nonce"), idClaims: claims });
      return call(`/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar });
    };

    // Another organization than the selected one installs nothing.
    expect((await finish(await start(), { org_id: ORG_B })).status).toBe(400);
    expect(await stwrd.sessions.get(sessionId)).not.toBeNull();

    // The match replaces the session: the old one is gone, the cookie points at the new one.
    const ok = await finish(await start(), { org_id: ORG_A, org_display_name: "Org A", org_roles: ["member"], org_permissions: [] });
    expect(ok.status).toBe(303);
    expect(await stwrd.sessions.get(sessionId)).toBeNull();
    expect(((await (await call("/auth/session", { jar })).json()) as { organization: { id: string } }).organization.id).toBe(ORG_A);
  });

  it("a selection whose originating session is gone installs nothing: 409", async () => {
    const { idp, stwrd, call, jar, csrf, sessionId } = await loggedIn();
    idp.memberships = [own(ORG_A, "Org A")];
    const started = await call("/auth/organization", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ organization_id: ORG_A }), jar,
    });
    await stwrd.sessions.delete(sessionId);
    const location = new URL(started.headers.get("location") as string);
    const code = idp.issueCode({ nonce: location.searchParams.get("nonce"), idClaims: { org_id: ORG_A } });
    const response = await call(`/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar });
    expect(response.status).toBe(409);
  });
});

describe("the access guards answer the way the Express guards did", () => {
  const rules: Array<[string, AccessRule]> = [
    ["requireAuth", { auth: true }], ["requireOrg", { org: true }],
    ["requireRole", { role: "org:admin" }], ["requirePermission", { permission: "members:invite" }],
  ];

  it.each(rules)("%s: no session is a 401 JSON for an API call and a 303 to sign-in for a navigation", async (_label, rule) => {
    const { stwrd } = await newStwrd();
    const api = await checkAccess(stwrd, { accept: "application/json", target: "/private" }, rule);
    expect(api.ok).toBe(false);
    if (!api.ok) {
      expect(api.response.status).toBe(401);
      expect(await api.response.json()).toEqual({ detail: "No session." });
    }
    const navigation = await checkAccess(stwrd, { accept: "text/html,application/xhtml+xml", target: "/a b?x=1" }, rule);
    if (!navigation.ok) {
      expect(navigation.response.status).toBe(303);
      expect(navigation.response.headers.get("location")).toBe("/auth/sign-in?return_to=%2Fa%20b%3Fx%3D1");
    } else throw new Error("expected a denial");
    // `api` forces the JSON denial even for a navigation.
    const forced = await checkAccess(stwrd, { accept: "text/html", target: "/private", api: true }, rule);
    expect(!forced.ok && forced.response.status).toBe(401);
  });

  it("a target outside this origin comes back as `/`", async () => {
    const { stwrd } = await newStwrd();
    const denied = await checkAccess(stwrd, { accept: "text/html", target: "//evil.example/x" }, { auth: true });
    expect(!denied.ok && denied.response.headers.get("location")).toBe("/auth/sign-in?return_to=%2F");
  });

  it("lets a person with the right claims through and says 403 to one without", async () => {
    const admin = await loggedIn({}, { idClaims: ADMIN });
    const cookie = admin.jar.get(SESSION_COOKIE);
    for (const [, rule] of rules) {
      const result = await checkAccess(admin.stwrd, { cookie, target: "/x" }, rule);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.context.user?.id).toBe("usr_1");
    }

    const member = await loggedIn({}, { idClaims: { org_id: "o1", org_display_name: "Team", org_roles: ["org:member"], org_permissions: [] } });
    const memberCookie = member.jar.get(SESSION_COOKIE);
    const expected: Array<[AccessRule, string]> = [
      [{ role: "org:admin" }, "Missing role org:admin."],
      [{ permission: "members:invite" }, "Missing permission members:invite."],
    ];
    for (const [rule, detail] of expected) {
      const denied = await checkAccess(member.stwrd, { cookie: memberCookie, target: "/x" }, rule);
      expect(!denied.ok && denied.response.status).toBe(403);
      expect(!denied.ok && (await denied.response.json())).toEqual({ detail });
    }
    expect((await checkAccess(member.stwrd, { cookie: memberCookie, target: "/x" }, { org: true })).ok).toBe(true);

    const none = await loggedIn();
    const noOrg = await checkAccess(none.stwrd, { cookie: none.jar.get(SESSION_COOKIE), target: "/x" }, { org: true });
    expect(!noOrg.ok && noOrg.response.status).toBe(403);
    expect(!noOrg.ok && (await noOrg.response.json())).toEqual({ detail: "The session has no organization." });
  });

  it("the org rule refuses to exist when the org scope was not requested", async () => {
    const { stwrd } = await newStwrd({ scope: "openid profile email" });
    await expect(checkAccess(stwrd, { target: "/x" }, { org: true })).rejects.toThrow("requireOrg requires the org scope.");
  });

  it("reads the session once when the caller already resolved it", async () => {
    const { stwrd } = await newStwrd();
    let reads = 0;
    stwrd.resolveSession = async () => (reads += 1, null);
    const resolved = { context: { user: null, organization: null, consents: {}, session: null }, idpUnavailable: false };
    await checkAccess(stwrd, { target: "/x", resolved }, { auth: true });
    expect(reads).toBe(0);
  });
});

describe("protect: what is public without a session", () => {
  it.each([
    ["the auth prefix itself", "/auth", true],
    ["anything under the auth prefix", "/auth/session", true],
    ["a lookalike of the prefix", "/authentic", false],
    ["an exact public path", "/health", true],
    ["a prefix of an exact path", "/health/deep", false],
    ["a trailing-star prefix", "/public/info", true],
    ["the star's own directory name", "/publicity", true],
    ["a path elsewhere", "/needs-session", false],
    ["a star in the middle is a character", "/a*b", false],
  ])("%s: %s → %s", (_label, path, expected) => {
    expect(isPublicPath(path, ["/health", "/public*", "/a*b/x"], "/auth")).toBe(expected);
  });

  it("everything not public needs a session: the denial is the guard's", async () => {
    const { stwrd } = await newStwrd();
    const path = "/needs-session";
    expect(isPublicPath(path, ["/public*"], stwrd.config.prefix)).toBe(false);
    const denied = await checkAccess(stwrd, { accept: "text/html", target: path }, { auth: true });
    expect(!denied.ok && denied.response.status).toBe(303);
  });
});

describe("an IdP that does not answer is never 'no session'", () => {
  type Context = Awaited<ReturnType<typeof loggedIn>>;
  const guard = (rule: AccessRule) => (c: Context) => checkAccess(c.stwrd, { cookie: c.jar.get(SESSION_COOKIE), accept: "application/json", target: "/x" }, rule);
  const DOORS: Array<[string, (c: Context) => Promise<Response>]> = [
    ["requireAuth", async (c) => ((await guard({ auth: true })(c)) as { response: Response }).response],
    ["requireOrg", async (c) => ((await guard({ org: true })(c)) as { response: Response }).response],
    ["requireRole", async (c) => ((await guard({ role: "org:admin" })(c)) as { response: Response }).response],
    ["requirePermission", async (c) => ((await guard({ permission: "members:invite" })(c)) as { response: Response }).response],
    ["protect (a path that is not public)", async (c) => ((await guard({ auth: true })(c)) as { response: Response }).response],
    ["/auth/session", (c) => c.call("/auth/session", { jar: c.jar })],
    ["/auth/organizations", (c) => c.call("/auth/organizations", { jar: c.jar })],
    ["/auth/organization", (c) => c.call("/auth/organization", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": c.csrf }, body: JSON.stringify({ organization_id: "11111111-1111-4111-8111-111111111111" }), jar: c.jar })],
    ["/auth/sign-in", (c) => c.call("/auth/sign-in", { jar: c.jar })],
  ];

  it.each(DOORS)("%s answers 503 and leaves the session in the store", async (path, door) => {
    const context = await loggedIn({}, { idClaims: ADMIN });
    await dueForRenewal(context.stwrd, context.sessionId);
    context.idp.silent = true;

    const response = await door(context);

    expect(response.status, `${path} lost a live session to a silent IdP`).toBe(503);
    expect(await context.stwrd.sessions.get(context.sessionId)).not.toBeNull();
  });

  it("the guards say so with Retry-After and the same sentence as everywhere else", async () => {
    const context = await loggedIn({}, { idClaims: ADMIN });
    await dueForRenewal(context.stwrd, context.sessionId);
    context.idp.silent = true;
    const result = await guard({ auth: true })(context);
    expect(!result.ok && result.response.headers.get("retry-after")).toBe("5");
    expect(!result.ok && (await result.response.json())).toEqual({ detail: IDP_SILENT });
  });
});
