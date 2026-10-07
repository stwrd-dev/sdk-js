/**
 * What every adapter has to do with the eight `/auth/*` routes and the guards,
 * written once against a harness: the Express router of `@stwrd-auth/node` (real
 * HTTP), the core's `authHandler` driven with `Request` objects (Node, no
 * socket) and the Worker adapter (workerd, a Durable Object as the store) all
 * run these same scenarios. A property that is only true of one adapter does
 * not belong here; the differences an adapter is allowed are the three fields
 * of `ContractAdapter`.
 */

import { describe, expect, it } from "vitest";

import type { BackChannelSink } from "@stwrd-auth/core/backchannel";
import type { StwrdCore } from "@stwrd-auth/core/client";
import type { StwrdConfigOptions } from "@stwrd-auth/core/config";
import { LOGOUT_EVENT_URI, type FetchLike } from "@stwrd-auth/core/oidc";
import type { SessionStore, StwrdSession } from "@stwrd-auth/core/sessions";
import type { FakeIdp, FakeIdpOptions } from "../fixtures/fakeIdp.js";

export const CLIENT_ID = "demo-client";
export const CLIENT_SECRET = "demo-secret";
export const BASE_URL = "https://demo.test";

export interface HarnessOptions {
  /** Configuration on top of the harness defaults (`scope` with `org`, a 32-character cookie secret). */
  config?: Partial<StwrdConfigOptions>;
  /** Passed to the fake IdP (`advertiseEndSession`, ...). */
  fakeIdp?: Partial<FakeIdpOptions>;
  /** Wraps the session store the adapter serves from (its own default), so a scenario can break one method. */
  wrapSessions?: (inner: SessionStore) => SessionStore;
  /** Where back-channel logout ends sessions. Only for adapters with `backChannelSink`. */
  backChannel?: BackChannelSink;
  /** Wraps the adapter's own back-channel sink. Only for adapters with `backChannelFault: "sink"`. */
  wrapBackChannel?: (inner: BackChannelSink) => BackChannelSink;
  /** Wraps the fetch the SDK is given, so a scenario can silence the IdP half way. */
  wrapFetch?: (inner: FetchLike) => FetchLike;
  /** Mount the fail-closed guard (`protectAll({ public: ["/public*"] })`) after the demo routes. */
  protectAll?: boolean;
}

export interface ContractJar {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
}

export interface ContractHarness {
  idp: FakeIdp;
  issuer: string;
  stwrd: StwrdCore;
  jar: ContractJar;
  /** One request through the app (demo routes and `/auth/*`), cookies in and out of `jar`. */
  call(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response>;
  close(): Promise<void>;
}

/** A cookie jar for harnesses that build `Request` objects: `absorb` takes the
 * `Set-Cookie` of a response, `header` is the `Cookie` of the next request. */
export class RequestJar implements ContractJar {
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

/** The demo app every harness serves, so the scenarios can name its routes:
 * `GET /whoami` (no guard: `{sub}`), `/private` (`requireAuth`, `{sub}`),
 * `/guarded` (`requireAuth`), `/org-only` (`requireOrg`), `/needs-role`
 * (`requireRole("org:admin")`), `/needs-permission`
 * (`requirePermission("members:invite")`) and, with `protectAll`,
 * `/public/info` (public) and `/needs-session`. */
export interface ContractAdapter {
  /** The status a request ends with when the session store throws. */
  storeDownStatus: number;
  /** What the adapter's store throws when it cannot answer. */
  storeError(): Error;
  /** Whether the adapter lets the app choose the back-channel sink. */
  backChannelSink: boolean;
  /** Where a back-channel failure is injected: the sink deletes through the
   * session store (`"sessions"`) or has its own storage (`"sink"`). */
  backChannelFault: "sessions" | "sink";
  make(options: HarnessOptions): Promise<ContractHarness>;
}

/** The body of a response as loosely typed JSON (runtimes type `Response.json()` differently). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonOf = async (response: Response): Promise<any> => response.json();

const ORG_ADMIN = { org_id: "org-1", org_display_name: "Team", org_roles: ["org:admin"], org_permissions: ["members:invite"] };
const form = { "content-type": "application/x-www-form-urlencoded" };
const json = { accept: "application/json" };

export async function login(
  h: ContractHarness,
  options: { idClaims?: Record<string, unknown>; returnTo?: string; userinfo?: Record<string, unknown> } = {},
): Promise<Response> {
  const signIn = await h.call(`/auth/sign-in?return_to=${encodeURIComponent(options.returnTo ?? "/private")}`);
  expect(signIn.status).toBe(303);
  const location = new URL(signIn.headers.get("location") as string);
  expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  const code = h.idp.issueCode({
    sub: "usr_1",
    idClaims: options.idClaims,
    nonce: location.searchParams.get("nonce"),
    userinfo: { email: "persona@example.test", email_verified: true, name: "Persona", ...options.userinfo },
  });
  return h.call(`/auth/callback?code=${code}&state=${location.searchParams.get("state")}`);
}

/** The local session id of the person signed in through `h.jar`. */
export function sessionIdOf(h: ContractHarness): string {
  return (h.stwrd.unseal(h.jar.get(h.stwrd.config.sessionCookie)) as { sid: string }).sid;
}

/** A `fetch` that can be silenced half way: the login goes through the real IdP
 * and the RENEWAL finds it mute, the only moment the IdP is needed. */
export function silenceable(): { wrap: (inner: FetchLike) => FetchLike; silence: () => void } {
  let silent = false;
  return {
    wrap: (inner) => (input, init) => (silent ? Promise.reject(new TypeError("fetch failed")) : inner(input, init)),
    silence: () => {
      silent = true;
    },
  };
}

/** Leaves the session just created with an expired access token and a refresh
 * token: the value does not matter, the IdP is silent before anyone looks at it. */
export async function dueForRenewal(h: ContractHarness): Promise<string> {
  const sessionId = sessionIdOf(h);
  const stored = await h.stwrd.sessions.get(sessionId);
  if (!stored) throw new Error("no session to age");
  const past = Date.now() / 1000 - 1;
  await h.stwrd.sessions.set({ ...stored, tokens: { ...stored.tokens, expiresAt: past, refresh_token: "rt-nobody-will-read" }, accessExpiresAt: past });
  return sessionId;
}

/** A store that delegates everything and lets a scenario break one method. */
export function breakable(inner: SessionStore, overrides: Partial<Record<keyof SessionStore, (...args: never[]) => Promise<unknown>>>): SessionStore {
  return new Proxy(inner, {
    get(target, property) {
      const override = overrides[property as keyof SessionStore];
      if (override) return override;
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function logoutToken(h: ContractHarness, options: { jti: string; sid: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return h.idp.sign({ iss: h.issuer, aud: [CLIENT_ID], iat: now, exp: now + 120, jti: options.jti, sid: options.sid, events: { [LOGOUT_EVENT_URI]: {} } });
}

const backChannel = (token: string) => ({ method: "POST", headers: form, body: new URLSearchParams({ logout_token: token }).toString() });

function liveSession(stwrd: StwrdCore, sid: string): StwrdSession {
  const now = Date.now() / 1000;
  return {
    id: stwrd.sessionIdForSid(sid),
    sidIdp: sid,
    sub: "user-1",
    claims: { sub: "user-1", sid },
    tokens: { access_token: "a", id_token: "i", token_type: "Bearer", expiresAt: now + 600 },
    expiresAt: now + 600,
    accessExpiresAt: now + 600,
  };
}

export function authContractScenarios(label: string, adapter: ContractAdapter): void {
  async function withHarness(options: HarnessOptions, run: (h: ContractHarness) => Promise<void>): Promise<void> {
    const harness = await adapter.make(options);
    try {
      await run(harness);
    } finally {
      await harness.close();
    }
  }

  describe(`authRouter (${label})`, () => {
    it("GET /auth/sign-in redirects to the authorize endpoint", async () => {
      await withHarness({}, async (h) => {
        const response = await h.call("/auth/sign-in?return_to=/private");
        expect(response.status).toBe(303);
        expect((response.headers.get("location") as string).startsWith(`${h.issuer}/oidc/authorize`)).toBe(true);
        expect(h.jar.get(h.stwrd.config.txCookie)).toBeTruthy();
      });
    });

    it("GET /auth/callback opens a session and redirects to return_to", async () => {
      await withHarness({}, async (h) => {
        const response = await login(h, { returnTo: "/private" });
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/private");
        expect(h.jar.get(h.stwrd.config.sessionCookie)).toBeTruthy();
      });
    });

    it("GET /auth/callback rejects a state that does not match", async () => {
      await withHarness({}, async (h) => {
        const signIn = await h.call("/auth/sign-in?return_to=/");
        const location = new URL(signIn.headers.get("location") as string);
        const code = h.idp.issueCode({ sub: "usr_1", nonce: location.searchParams.get("nonce") });
        const response = await h.call(`/auth/callback?code=${code}&state=not-the-right-state`);
        expect(response.status).toBe(400);
      });
    });

    it("GET /auth/callback with no transaction cookie is rejected", async () => {
      await withHarness({}, async (h) => {
        expect((await h.call("/auth/callback?code=x&state=y")).status).toBe(400);
      });
    });

    it("GET /auth/session reports the session after login", async () => {
      await withHarness({}, async (h) => {
        await login(h);
        const response = await h.call("/auth/session");
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const body = await jsonOf(response);
        expect(body.authenticated).toBe(true);
        expect(Object.keys(body).sort()).toEqual(["account_url", "authenticated", "consents", "csrf_token", "organization", "user"]);
        expect(Object.keys(body.user).sort()).toEqual(["avatar_url", "display_name", "email", "email_verified", "id", "permissions", "roles"]);
        expect(body.user.id).toBe("usr_1");
        expect(body.user.email).toBe("persona@example.test");
        expect(body.csrf_token).toBeTruthy();
        expect(body.account_url).toBe(`${h.issuer}/me`);
      });
    });

    it("GET /auth/session reports consents from userinfo", async () => {
      // Consents report state ("accepted", "pending"), never versions.
      await withHarness({}, async (h) => {
        await login(h, { userinfo: { consents: { terms: "accepted", marketing: "pending" } } });
        const body = await jsonOf(await h.call("/auth/session"));
        expect(body.consents).toEqual({ terms: "accepted", marketing: "pending" });
      });
    });

    it("GET /auth/session without a session has the same shape", async () => {
      await withHarness({}, async (h) => {
        expect((await h.call("/auth/me")).status).toBe(404);
        const body = await jsonOf(await h.call("/auth/session"));
        // "la forma no cambia" — same keys, authenticated: false.
        expect(body).toEqual({ authenticated: false, user: null, organization: null, consents: {}, csrf_token: null, account_url: `${h.issuer}/me` });
      });
    });

    it("GET /auth/callback re-checks the sealed return_to: an off-origin target falls back to the default", async () => {
      await withHarness({}, async (h) => {
        const signIn = await h.call("/auth/sign-in?return_to=/private");
        const location = new URL(signIn.headers.get("location") as string);
        // A transaction that got in with an unchecked target (older SDK, custom store).
        const tx = h.stwrd.unseal(h.jar.get(h.stwrd.config.txCookie)) as Record<string, unknown>;
        h.jar.set(h.stwrd.config.txCookie, h.stwrd.seal({ ...tx, return_to: "https://evil.example/steal" }));
        const code = h.idp.issueCode({
          sub: "usr_1",
          nonce: location.searchParams.get("nonce"),
          userinfo: { email: "persona@example.test", email_verified: true, name: "Persona" },
        });
        const response = await h.call(`/auth/callback?code=${code}&state=${location.searchParams.get("state")}`);
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe(h.stwrd.config.postLoginRedirect);
      });
    });

    it("POST /auth/sign-out requires CSRF", async () => {
      await withHarness({}, async (h) => {
        await login(h);
        expect((await h.call("/auth/sign-out", { method: "POST" })).status).toBe(403);
      });
    });

    it.each([
      ["wrong, same length", (valid: string) => `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`],
      ["shorter than the real one", (valid: string) => valid.slice(0, -1)],
      ["longer than the real one", (valid: string) => `${valid}x`],
      ["non-ASCII", () => "csrf-ü"],
    ])("POST /auth/sign-out rejects a %s CSRF token with 403 and keeps the session", async (_label, forge) => {
      await withHarness({}, async (h) => {
        await login(h);
        const me = await jsonOf(await h.call("/auth/session"));
        const response = await h.call("/auth/sign-out", { method: "POST", headers: form, body: new URLSearchParams({ csrf_token: forge(me.csrf_token as string) }).toString() });
        expect(response.status).toBe(403);
        expect((await jsonOf(await h.call("/auth/session"))).authenticated).toBe(true);
      });
    });

    it("POST /auth/sign-out clears the session with a valid CSRF", async () => {
      await withHarness({}, async (h) => {
        await login(h);
        const me = await jsonOf(await h.call("/auth/session"));
        const response = await h.call("/auth/sign-out", { method: "POST", headers: { "x-csrf-token": me.csrf_token } });
        expect(response.status).toBe(303);
        // No end_session_endpoint advertised (fake_idp default): degrades to
        // the local post-logout redirect.
        expect(response.headers.get("location")).toBe(`${BASE_URL}/`);
        expect(h.jar.get(h.stwrd.config.sessionCookie)).toBeUndefined();
        expect((await jsonOf(await h.call("/auth/session"))).authenticated).toBe(false);
      });
    });

    it("POST /auth/sign-out with no session redirects without requiring CSRF", async () => {
      await withHarness({}, async (h) => {
        expect((await h.call("/auth/sign-out", { method: "POST" })).status).toBe(303);
      });
    });

    it("POST /auth/sign-out goes to end_session when advertised", async () => {
      await withHarness({ fakeIdp: { advertiseEndSession: true } }, async (h) => {
        await login(h);
        const me = await jsonOf(await h.call("/auth/session"));
        const response = await h.call("/auth/sign-out", { method: "POST", headers: { "x-csrf-token": me.csrf_token } });
        expect(response.status).toBe(303);
        expect((response.headers.get("location") as string).startsWith(`${h.issuer}/oidc/end-session`)).toBe(true);
      });
    });

    it("POST /auth/webhook without a secret configured is 503", async () => {
      await withHarness({ config: { webhookSecret: "" } }, async (h) => {
        const response = await h.call("/auth/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        expect(response.status).toBe(503);
        expect(await jsonOf(response)).toEqual({ error: "webhook_not_configured" });
      });
    });

    it("POST /auth/webhook rejects a bad signature", async () => {
      await withHarness({ config: { webhookSecret: "whsec-x" } }, async (h) => {
        const response = await h.call("/auth/webhook", {
          method: "POST",
          headers: { "content-type": "application/json", "webhook-id": "x", "webhook-timestamp": "123", "webhook-signature": "v1,not-a-real-signature==" },
          body: JSON.stringify({ id: "x", type: "user.created", api_version: "v1", created_at: "2026-01-01T00:00:00Z", data: {} }),
        });
        expect(response.status).toBe(400);
        expect(await jsonOf(response)).toEqual({ error: "invalid_signature" });
      });
    });

    it("POST /auth/back-channel rejects a missing token", async () => {
      await withHarness({}, async (h) => {
        const response = await h.call("/auth/back-channel", { method: "POST" });
        expect(response.status).toBe(400);
        expect(response.headers.get("cache-control")).toBe("no-store");
      });
    });

    it("POST /auth/back-channel accepts a well-formed logout_token and rejects replay", async () => {
      await withHarness({}, async (h) => {
        const request = backChannel(await logoutToken(h, { jti: "logout-1", sid: "s1" }));
        const response = await h.call("/auth/back-channel", request);
        expect(response.status).toBe(200);
        expect(await jsonOf(response)).toEqual({ status: "ok" });
        expect((await h.call("/auth/back-channel", request)).status).toBe(400);
      });
    });

    it("POST /auth/back-channel actually ends the local session", async () => {
      // The property, not the 200 response: the provider's notice has to leave
      // the local session dead.
      await withHarness({}, async (h) => {
        const session = liveSession(h.stwrd, "s-live");
        await h.stwrd.sessions.set(session);
        expect(await h.stwrd.sessions.get(session.id)).not.toBeNull();
        const response = await h.call("/auth/back-channel", backChannel(await logoutToken(h, { jti: "logout-ends", sid: "s-live" })));
        expect(response.status).toBe(200);
        expect(await h.stwrd.sessions.get(session.id)).toBeNull();
      });
    });

    it("POST /auth/back-channel: a failed deletion leaves the jti unseen so the retry ends the session", async () => {
      // The provider retries a 5xx and not a 4xx: if the `jti` were marked as
      // seen before the deletion, the retry would get a 400 "replay" and the
      // local session would stay alive forever.
      let failuresLeft = 1;
      const fail = () => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw adapter.storeError();
        }
      };
      const faults: HarnessOptions =
        adapter.backChannelFault === "sessions"
          ? { wrapSessions: (inner) => breakable(inner, { delete: async (id: string) => { fail(); return inner.delete(id); } }) }
          : { wrapBackChannel: (inner) => ({ terminate: async (sessionId, jti, untilS) => { fail(); return inner.terminate(sessionId, jti, untilS); } }) };
      await withHarness(faults, async (h) => {
        const session = liveSession(h.stwrd, "s-reintento");
        await h.stwrd.sessions.set(session);
        const send = async () => h.call("/auth/back-channel", backChannel(await logoutToken(h, { jti: "logout-reintento", sid: "s-reintento" })));

        expect((await send()).status).toBe(adapter.storeDownStatus);
        expect(await h.stwrd.sessions.get(session.id)).not.toBeNull();
        expect((await send()).status).toBe(200);
        expect(await h.stwrd.sessions.get(session.id)).toBeNull();
        // Once the session is really gone the jti is burned: a third delivery is a replay.
        expect((await send()).status).toBe(400);
      });
    });

    if (adapter.backChannelSink) {
      it("POST /auth/back-channel ends sessions through the sink the app gave", async () => {
        const seen: Array<{ sessionId: string | null; jti: string; untilS: number }> = [];
        const sink: BackChannelSink = {
          async terminate(sessionId, jti, untilS) {
            seen.push({ sessionId, jti, untilS });
            return jti === "logout-seen" ? "replay" : "terminated";
          },
        };
        await withHarness({ backChannel: sink }, async (h) => {
          const ok = await h.call("/auth/back-channel", backChannel(await logoutToken(h, { jti: "logout-sink", sid: "s-sink" })));
          expect(ok.status).toBe(200);
          const replay = await h.call("/auth/back-channel", backChannel(await logoutToken(h, { jti: "logout-seen", sid: "s-sink" })));
          expect(replay.status).toBe(400);
          expect(seen.map((call) => [call.sessionId, call.jti])).toEqual([
            [h.stwrd.sessionIdForSid("s-sink"), "logout-sink"],
            [h.stwrd.sessionIdForSid("s-sink"), "logout-seen"],
          ]);
          expect(seen[0].untilS).toBeGreaterThan(Date.now() / 1000);
        });
      });
    }

    it("a store that does not answer is never read as 'no session'", async () => {
      // "Cannot tell" is not "no session": the person stays signed in.
      let down = false;
      const wrapSessions = (inner: SessionStore) =>
        breakable(inner, {
          get: async (id: string) => {
            if (down) throw adapter.storeError();
            return inner.get(id);
          },
        });
      await withHarness({ wrapSessions }, async (h) => {
        await login(h);
        down = true;
        for (const path of ["/auth/session", "/private", "/whoami"]) {
          const response = await h.call(path, { headers: json });
          expect(response.status, path).toBe(adapter.storeDownStatus);
        }
        down = false;
        expect((await h.call("/private", { headers: json })).status).toBe(200);
      });
    });

    it("a callback whose session cannot be stored is not a login", async () => {
      const wrapSessions = (inner: SessionStore) =>
        breakable(inner, {
          set: async () => {
            throw adapter.storeError();
          },
        });
      await withHarness({ wrapSessions }, async (h) => {
        const response = await login(h);
        expect(response.status).toBe(adapter.storeDownStatus);
        expect(h.jar.get(h.stwrd.config.sessionCookie)).toBeUndefined();
      });
    });

    // --- guards ----------------------------------------------------------

    it("without attach()/session, req.stwrd.user is null on an unauthenticated request", async () => {
      await withHarness({}, async (h) => {
        expect(await jsonOf(await h.call("/whoami"))).toEqual({ sub: null });
      });
    });

    it("req.stwrd.user is populated after login", async () => {
      await withHarness({}, async (h) => {
        await login(h);
        expect(await jsonOf(await h.call("/whoami"))).toEqual({ sub: "usr_1" });
      });
    });

    it("requireAuth redirects a navigation without a session", async () => {
      await withHarness({}, async (h) => {
        const response = await h.call("/private", { headers: { accept: "text/html" } });
        expect(response.status).toBe(303);
        expect((response.headers.get("location") as string).includes("/auth/sign-in")).toBe(true);
      });
    });

    it("requireAuth answers 401 JSON for a non-navigation", async () => {
      await withHarness({}, async (h) => {
        expect((await h.call("/private", { headers: json })).status).toBe(401);
      });
    });

    it("requireAuth returns the user once signed in", async () => {
      await withHarness({}, async (h) => {
        await login(h);
        const response = await h.call("/private");
        expect(response.status).toBe(200);
        expect(await jsonOf(response)).toEqual({ sub: "usr_1" });
      });
    });

    it("requireAuth guards without needing the user's return value", async () => {
      await withHarness({}, async (h) => {
        expect((await h.call("/guarded", { headers: json })).status).toBe(401);
        await login(h);
        expect((await h.call("/guarded")).status).toBe(200);
      });
    });

    it("requireOrg denies a session with no organisation", async () => {
      await withHarness({}, async (h) => {
        await login(h);
        expect((await h.call("/org-only", { headers: json })).status).toBe(403);
      });
    });

    it("requireRole/requirePermission pass with a matching organisation claim", async () => {
      await withHarness({}, async (h) => {
        await login(h, { idClaims: ORG_ADMIN });
        expect((await h.call("/org-only")).status).toBe(200);
        expect((await h.call("/needs-role")).status).toBe(200);
        expect((await h.call("/needs-permission")).status).toBe(200);
      });
    });

    it("requireRole denies a session without the role", async () => {
      await withHarness({}, async (h) => {
        await login(h, { idClaims: { org_id: "org-1", org_display_name: "Team", org_roles: ["org:member"], org_permissions: [] } });
        expect((await h.call("/needs-role")).status).toBe(403);
      });
    });

    // --- protectAll ---------------------------------------------------------

    it("protectAll allows the public allowlist and the auth prefix", async () => {
      await withHarness({ protectAll: true }, async (h) => {
        expect((await h.call("/public/info")).status).toBe(200);
        // Everything under the auth prefix is public without being listed —
        // otherwise the redirect target itself would need a session, and the
        // webhook receiver would 401 forever.
        expect((await h.call("/auth/session")).status).toBe(200);
      });
    });

    it("protectAll denies everything else by default", async () => {
      await withHarness({ protectAll: true }, async (h) => {
        const navigation = await h.call("/needs-session", { headers: { accept: "text/html" } });
        expect(navigation.status).toBe(303);
        expect((navigation.headers.get("location") as string).includes("/auth/sign-in")).toBe(true);
        expect((await h.call("/needs-session", { headers: json })).status).toBe(401);
      });
    });

    // --- a silent provider: no guard turns it into "no session" ---------------

    // The gates through which a request with a live session goes through
    // `resolveSession`, and what each one used to do BEFORE telling silence
    // apart from rejection. Each had its own way of telling someone who had
    // not left that they had.
    const GATES: Array<[string, string]> = [
      ["/private", "requireAuth answered 401 and sent the person to sign in"],
      ["/guarded", "requireAuth answered 401"],
      ["/org-only", "requireOrg answered 401"],
      ["/needs-role", "requireRole answered 401"],
      ["/needs-permission", "requirePermission answered 401"],
      ["/auth/session", "/auth/session said authenticated:false"],
    ];

    for (const [path, damage] of GATES) {
      it(`with a silent provider, ${path} answers 503 and keeps the session`, async () => {
        // One property, not six cases: "cannot tell" is never translated to
        // "no session". And the session is still in the store at the end: if a
        // guard deleted it, the 503 would be honest and the damage done anyway.
        const { wrap, silence } = silenceable();
        await withHarness({ wrapFetch: wrap }, async (h) => {
          await login(h, { idClaims: { ...ORG_ADMIN, org_id: "o1" } });
          const sessionId = await dueForRenewal(h);
          silence();

          const response = await h.call(path, { headers: json });

          expect(response.status, `${path} — before: ${damage}`).toBe(503);
          expect(await h.stwrd.sessions.get(sessionId)).not.toBeNull();
        });
      });
    }

    it("protectAll does not bounce a live session to sign-in when the provider does not answer", async () => {
      // The most visible guard: the 303 to sign-in shows the person the login
      // screen, which in product terms means "your session was closed".
      const { wrap, silence } = silenceable();
      await withHarness({ wrapFetch: wrap, protectAll: true }, async (h) => {
        await login(h, { returnTo: "/needs-session" });
        const sessionId = await dueForRenewal(h);
        silence();

        const navigation = await h.call("/needs-session", { headers: { accept: "text/html" } });

        expect(navigation.status).toBe(503);
        expect(await h.stwrd.sessions.get(sessionId)).not.toBeNull();
      });
    });

    it("back-channel answers 503 and not 400 when the JWKS does not respond", async () => {
      // **This is about security, not convenience.** `validateLogoutToken`
      // downloads the JWKS to verify the signature, so an issuer hiccup shows
      // up there. The provider retries a 5xx and does NOT retry a 4xx (a 4xx
      // means the receiver rejected this token), so a 400 would lose the
      // notice FOREVER: the provider closed the session and this server would
      // never find out.
      const { wrap, silence } = silenceable();
      await withHarness({ wrapFetch: wrap }, async (h) => {
        // A WELL-FORMED token: with a garbage one the signature is never
        // attempted and the 400 would be correct. What is exercised is the
        // JWKS step.
        const token = await logoutToken(h, { jti: "logout-silent", sid: "s1" });
        // Only now does it go silent: the notice arrives and the JWKS does not.
        silence();
        const response = await h.call("/auth/back-channel", backChannel(token));
        expect(response.status, "a 400 tells the issuer to stop sending it").toBe(503);
      });
    });
  });

  describe(`uncertain refresh (${label})`, () => {
    it("/auth/sign-in is the way out: it goes to the authorize endpoint", async () => {
      await withHarness({}, async (h) => {
        expect((await login(h)).status).toBe(303);
        const sid = sessionIdOf(h);
        const session = (await h.stwrd.sessions.get(sid)) as StwrdSession;
        await h.stwrd.sessions.set({ ...session, tokens: { ...session.tokens, refresh_token: "rt" }, accessExpiresAt: Date.now() / 1000 - 1 });
        const lease = await h.stwrd.sessions.claimRefresh(sid, "dead-worker", 30);
        if (lease.status !== "granted") throw new Error("expected a grant");
        await h.stwrd.sessions.markRefreshSent(sid, lease.fence);
        await h.stwrd.sessions.releaseRefresh(sid, lease.fence, true); // outcome unknown

        expect((await h.call("/auth/session")).status).toBe(503);
        const started = await h.call("/auth/sign-in?return_to=/private");
        expect(started.status).toBe(303);
        expect((started.headers.get("location") as string).startsWith(`${h.issuer}/oidc/authorize`)).toBe(true);
      });
    });
  });
}
