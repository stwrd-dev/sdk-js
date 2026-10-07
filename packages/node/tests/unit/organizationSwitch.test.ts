/** BFF organization selection: list own organizations, start a switch through a
 * real authorization request, and replace the live session only when the
 * callback matches exactly. */

import { randomUUID } from "node:crypto";

import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Stwrd, createStwrd } from "../../src/client.js";
import type { FetchLike } from "@stwrd-auth/core/oidc";
import { FakeIdp } from "../fixtures/fakeIdp.js";
import { BASE_URL, CLIENT_ID, CLIENT_SECRET } from "./helpers.js";
import { CookieJar, TestServer, jarFetch } from "./testServer.js";

const PUBLIC = "https://auth.example.com";
const ORG_A = randomUUID();
const ORG_B = randomUUID();
const ORG_OTHER = randomUUID();
const membership = (id: string, name: string | null, active = true) => ({ organization: { id, display_name: name }, active });

interface Harness { idp: FakeIdp; stwrd: Stwrd; base: string; jar: CookieJar }

async function withHarness(run: (h: Harness) => Promise<void>, options: { scope?: string } = {}): Promise<void> {
  const idp = new FakeIdp({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: `${BASE_URL}/auth/callback`, publicIssuer: PUBLIC });
  await idp.start();
  // Route the https issuer origin to the loopback server.
  const routed: FetchLike = (input, init) => fetch(input.startsWith(PUBLIC) ? idp.localOrigin + input.slice(PUBLIC.length) : input, init);
  const stwrd = createStwrd({
    issuer: PUBLIC, scope: options.scope ?? "openid profile email org", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    baseUrl: BASE_URL, cookieSecret: "x".repeat(32), cookieSecure: false, fetch: routed,
  });
  const server = new TestServer();
  const app = express();
  app.use(stwrd.attach());
  app.use(stwrd.authRouter());
  const base = await server.start(app);
  try { await run({ idp, stwrd, base, jar: new CookieJar() }); } finally { await server.stop(); await idp.stop(); }
}

async function signIn({ idp, stwrd, base, jar }: Harness): Promise<string> {
  idp.memberships = [membership(ORG_A, "Org A"), membership(ORG_B, "Org B")];
  const start = await jarFetch(`${base}/auth/sign-in?return_to=/`, { jar });
  const location = new URL(start.headers.get("location") as string);
  const code = idp.issueCode({ sub: "usr_1", nonce: location.searchParams.get("nonce"), userinfo: { email: "p@example.test", email_verified: true } });
  const done = await jarFetch(`${base}/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar });
  expect(done.status).toBe(303);
  const session = (await (await jarFetch(`${base}/auth/session`, { jar })).json()) as { csrf_token: string };
  void stwrd;
  return session.csrf_token;
}

const startSwitch = (h: Harness, csrf: string | null, org: string, extra: Record<string, string> = {}) =>
  jarFetch(`${h.base}/auth/organization`, {
    jar: h.jar, method: "POST",
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: JSON.stringify({ organization_id: org, ...extra }),
  });

async function finishSwitch(h: Harness, started: Response, issued: { sub?: string; idClaims?: Record<string, unknown> } = {}): Promise<Response> {
  const location = new URL(started.headers.get("location") as string);
  const code = h.idp.issueCode({
    sub: issued.sub ?? "usr_1", nonce: location.searchParams.get("nonce"),
    userinfo: { email: "p@example.test", email_verified: true },
    idClaims: issued.idClaims ?? { org_id: location.searchParams.get("organization_id"), org_display_name: "Selected", org_roles: ["member"], org_permissions: [] },
  });
  return jarFetch(`${h.base}/auth/callback?code=${code}&state=${location.searchParams.get("state")}`, { jar: h.jar });
}

describe("organization selection", () => {
  it("lists only active own organizations across pages", async () => {
    await withHarness(async h => {
      await signIn(h);
      h.idp.memberships = [membership(ORG_A, "Org A"), membership(ORG_OTHER, "Suspended", false), membership(ORG_B, null)];
      h.idp.membershipsPageSize = 1;
      const response = await jarFetch(`${h.base}/auth/organizations`, { jar: h.jar });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ organizations: [
        { id: ORG_A, display_name: "Org A", current: false },
        { id: ORG_B, display_name: null, current: false },
      ] });
      expect(h.idp.membershipAuthorizations.every(value => value.startsWith("Bearer "))).toBe(true);
    });
  });

  it("requires a session and the explicit org scope", async () => {
    await withHarness(async h => {
      expect((await jarFetch(`${h.base}/auth/organizations`, { jar: h.jar })).status).toBe(401);
      expect((await startSwitch(h, null, ORG_A)).status).toBe(401);
    });
    await withHarness(async h => {
      expect((await jarFetch(`${h.base}/auth/organizations`, { jar: h.jar })).status).toBe(404);
      expect((await startSwitch(h, null, ORG_A)).status).toBe(404);
    }, { scope: "openid profile email" });
  });

  it("answers 503, never an empty list, when the IdP is silent", async () => {
    await withHarness(async h => {
      await signIn(h);
      for (const status of [502, 403]) {
        h.idp.membershipsStatus = status;
        expect((await jarFetch(`${h.base}/auth/organizations`, { jar: h.jar })).status).toBe(503);
      }
    });
  });

  it.each([
    { managementBaseUrl: "http://auth.example.com/api/v1" },
    { managementAudience: "https://other.test" },
  ])("never sends the token to an untrusted management destination: %o", async advertised => {
    await withHarness(async h => {
      await signIn(h);
      Object.assign(h.idp, advertised);
      (h.stwrd.oidc as unknown as { discoveryDoc: unknown }).discoveryDoc = null; // re-read, as after a restart
      expect((await jarFetch(`${h.base}/auth/organizations`, { jar: h.jar })).status).toBe(503);
      expect(h.idp.membershipAuthorizations).toEqual([]);
    });
  });

  it("requires CSRF, a UUID and a current membership to start a switch", async () => {
    await withHarness(async h => {
      const csrf = await signIn(h);
      expect((await startSwitch(h, null, ORG_A)).status).toBe(403);
      expect((await startSwitch(h, "wrong", ORG_A)).status).toBe(403);
      expect((await startSwitch(h, csrf, "not-a-uuid")).status).toBe(400);
      expect((await startSwitch(h, csrf, ORG_OTHER)).status).toBe(404);
      expect(h.jar.get(h.stwrd.config.txCookie)).toBeUndefined();
    });
  });

  it("starts a real authorization request and keeps the live session untouched", async () => {
    await withHarness(async h => {
      const csrf = await signIn(h);
      const before = h.jar.get(h.stwrd.config.sessionCookie);
      const started = await startSwitch(h, csrf, ORG_B.toUpperCase(), { return_to: "https://evil.test/" });
      expect(started.status).toBe(303);
      const location = new URL(started.headers.get("location") as string);
      expect(location.href.startsWith(`${PUBLIC}/oidc/authorize`)).toBe(true);
      expect(location.searchParams.get("organization_id")).toBe(ORG_B);
      expect(location.searchParams.get("scope")?.split(" ")).toContain("org");
      expect(location.searchParams.get("code_challenge_method")).toBe("S256");
      expect(h.jar.get(h.stwrd.config.txCookie)).toBeTruthy();
      expect(h.jar.get(h.stwrd.config.sessionCookie)).toBe(before);
    });
  });

  it("a matching callback replaces the session with the selected organization", async () => {
    await withHarness(async h => {
      const csrf = await signIn(h);
      const oldCookie = h.jar.get(h.stwrd.config.sessionCookie) as string;
      const started = await startSwitch(h, csrf, ORG_B);
      const finished = await finishSwitch(h, started);
      expect(finished.status).toBe(303);
      expect(finished.headers.get("location")).toBe("/");
      expect(h.jar.get(h.stwrd.config.txCookie)).toBeUndefined();
      expect(h.jar.get(h.stwrd.config.sessionCookie)).not.toBe(oldCookie);
      const session = (await (await jarFetch(`${h.base}/auth/session`, { jar: h.jar })).json()) as { organization: { id: string } };
      expect(session.organization.id).toBe(ORG_B);
      const old = h.stwrd.unseal(oldCookie) as { sid: string };
      expect(await h.stwrd.sessions.get(old.sid)).toBeNull();
    });
  });

  it.each([
    ["other person", { sub: "usr_other" }],
    ["other organization", { idClaims: { org_id: ORG_A, org_display_name: "A", org_roles: [], org_permissions: [] } }],
    ["no organization", { idClaims: {} }],
  ])("a callback that does not match installs nothing: %s", async (_name, mismatch) => {
    await withHarness(async h => {
      const csrf = await signIn(h);
      const oldCookie = h.jar.get(h.stwrd.config.sessionCookie) as string;
      const finished = await finishSwitch(h, await startSwitch(h, csrf, ORG_B), mismatch);
      expect(finished.status).toBe(400);
      expect(h.jar.get(h.stwrd.config.sessionCookie)).toBe(oldCookie);
      expect(await h.stwrd.sessions.get((h.stwrd.unseal(oldCookie) as { sid: string }).sid)).not.toBeNull();
    });
  });

  it("a logout before the callback is never undone, and a replay installs nothing", async () => {
    await withHarness(async h => {
      const csrf = await signIn(h);
      const oldSid = (h.stwrd.unseal(h.jar.get(h.stwrd.config.sessionCookie)) as { sid: string }).sid;
      const started = await startSwitch(h, csrf, ORG_B);
      await h.stwrd.sessions.delete(oldSid);
      expect((await finishSwitch(h, started)).status).toBe(409);
      expect(((await (await jarFetch(`${h.base}/auth/session`, { jar: h.jar })).json()) as { authenticated: boolean }).authenticated).toBe(false);
    });
    await withHarness(async h => {
      const csrf = await signIn(h);
      const started = await startSwitch(h, csrf, ORG_B);
      const tx = h.jar.get(h.stwrd.config.txCookie) as string;
      expect((await finishSwitch(h, started)).status).toBe(303);
      // replay the same transaction cookie
      (h.jar as unknown as { values: Map<string, string> }).values.set(h.stwrd.config.txCookie, tx);
      expect((await finishSwitch(h, started)).status).toBe(409);
    });
  });
});
