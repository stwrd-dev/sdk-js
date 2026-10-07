// `stwrdFor`: the Worker's `env` becomes a configured adapter, or the Worker
// does not start.
import { env as workerEnv } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { ConfigError } from "@stwrd-auth/core/config";
import { IdpUnavailable } from "@stwrd-auth/core/oidc";
import { MemoryStore, type SessionStore } from "@stwrd-auth/core/sessions";
import { DurableObjectSessionStore } from "../../src/store.js";
import { StwrdWorkers, stwrdFor } from "../../src/stwrd.js";

const KEY = Buffer.alloc(32, 9).toString("base64url");
const variables = {
  STWRD_ISSUER: "https://idp.fake.test",
  STWRD_CLIENT_ID: "client-1",
  STWRD_CLIENT_SECRET: "shh",
  STWRD_BASE_URL: "https://app.example",
  STWRD_COOKIE_SECRET: "k".repeat(32),
};
const goodEnv = (extra: Record<string, unknown> = {}) => ({ ...variables, STWRD_SESSION_KEYS: `k1:${KEY}`, STWRD_SESSIONS: workerEnv.STWRD_SESSIONS, ...extra });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://app.example${path}`, { headers });

describe("stwrdFor", () => {
  it("builds the adapter from the variables, with the Durable Object store", async () => {
    const stwrd = stwrdFor(goodEnv());
    expect(stwrd).toBeInstanceOf(StwrdWorkers);
    expect(stwrd.sessions).toBeInstanceOf(DurableObjectSessionStore);
    expect(stwrd.config.issuer).toBe("https://idp.fake.test");
    const response = await stwrd.handle(get("/auth/session"));
    expect(response?.status).toBe(200);
    expect(((await response?.json()) as { authenticated: boolean }).authenticated).toBe(false);
  });

  it("reuses the instance of an env, and builds another for another env", () => {
    const one = goodEnv();
    expect(stwrdFor(one)).toBe(stwrdFor(one));
    expect(stwrdFor(goodEnv())).not.toBe(stwrdFor(one));
  });

  describe("a later call for the same env", () => {
    const hook = () => undefined;

    it("with no options, or with the first call's options, gets the same instance", () => {
      const env = goodEnv();
      const first = stwrdFor(env, { scope: "openid org", onUserRegistered: hook });
      expect(stwrdFor(env)).toBe(first);
      expect(stwrdFor(env, {})).toBe(first);
      expect(stwrdFor(env, { onUserRegistered: hook, scope: "openid org" })).toBe(first);
    });

    it("with other value options is a ConfigError, not options silently ignored", () => {
      const env = goodEnv();
      stwrdFor(env, { scope: "openid org", onUserRegistered: hook });
      expect(() => stwrdFor(env, { scope: "openid" })).toThrow(ConfigError);
      expect(() => stwrdFor(env, { scope: "openid org", prefix: "/id" })).toThrow(ConfigError);
      const bare = goodEnv();
      stwrdFor(bare);
      expect(() => stwrdFor(bare, { scope: "openid org" })).toThrow(ConfigError);
    });

    it("ignores the callbacks of a later call: the first call's stay, with no error", () => {
      const env = goodEnv();
      const first = stwrdFor(env, { scope: "openid org", onUserRegistered: hook });
      // declared inline in `fetch`: a new function on every request
      expect(stwrdFor(env, { scope: "openid org", onUserRegistered: () => undefined })).toBe(first);
      expect(stwrdFor(env, { scope: "openid org" })).toBe(first); // a hook less
      expect(stwrdFor(env, { onUserRegistered: () => undefined, onEvent: () => undefined })).toBe(first);
      const bare = goodEnv();
      const instance = stwrdFor(bare);
      expect(stwrdFor(bare, { onUserRegistered: () => undefined })).toBe(instance); // a hook added
    });
  });

  it("answers null for what is not an auth route", async () => {
    expect(await stwrdFor(goodEnv()).handle(get("/private"))).toBeNull();
  });

  it("options win over the environment, and the hooks reach the handler", () => {
    const stwrd = stwrdFor(goodEnv(), { scope: "openid org", onUserRegistered: () => undefined });
    expect(stwrd.config.scope).toBe("openid org");
  });

  describe("fails closed", () => {
    it.each(["STWRD_ISSUER", "STWRD_CLIENT_ID", "STWRD_CLIENT_SECRET", "STWRD_BASE_URL", "STWRD_COOKIE_SECRET"])("without %s", (name) => {
      expect(() => stwrdFor(goodEnv({ [name]: undefined }))).toThrow(new RegExp(name));
    });

    it("without the Buffer global, which is what a Worker without nodejs_compat has", () => {
      vi.stubGlobal("Buffer", undefined);
      try {
        expect(() => stwrdFor(goodEnv())).toThrow(ConfigError);
        expect(() => stwrdFor(goodEnv())).toThrow(/nodejs_compat/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("with a cookie secret under 32 characters", () => {
      expect(() => stwrdFor(goodEnv({ STWRD_COOKIE_SECRET: "short" }))).toThrow(ConfigError);
    });

    it.each<[string, Record<string, unknown>]>([
      ["no binding", { STWRD_SESSIONS: undefined }],
      ["a binding that is not a Durable Object namespace", { STWRD_SESSIONS: "nope" }],
      ["no session keys", { STWRD_SESSION_KEYS: undefined }],
      ["empty session keys", { STWRD_SESSION_KEYS: "" }],
      ["a session key of the wrong length", { STWRD_SESSION_KEYS: "k1:abc" }],
    ])("with %s", (_label, extra) => {
      expect(() => stwrdFor(goodEnv(extra))).toThrow(ConfigError);
    });
  });

  describe("the memory store is only ever explicit", () => {
    it("needs neither the binding nor the keys when the app passes its own store", () => {
      const sessions = new MemoryStore();
      const stwrd = stwrdFor({ ...variables }, { sessions });
      expect(stwrd.sessions).toBe(sessions);
    });
  });

  describe("a store that cannot answer", () => {
    const failing = (error: Error): SessionStore => {
      const reject = () => Promise.reject(error);
      return { get: reject, set: reject, delete: reject, replaceSession: reject, claimRefresh: reject, markRefreshSent: reject, checkpointRefresh: reject, completeRefresh: reject, releaseRefresh: reject } as unknown as SessionStore;
    };
    const signOutWithSession = (stwrd: StwrdWorkers) =>
      new Request("https://app.example/auth/sign-out", { method: "POST", headers: { cookie: `${stwrd.config.sessionCookie}=${stwrd.seal({ sid: "s1" })}` } });

    it("is a 503, the way an IdP that does not answer is", async () => {
      const stwrd = stwrdFor({ ...variables }, { sessions: failing(new IdpUnavailable("store down")) });
      const response = await stwrd.handle(signOutWithSession(stwrd));
      expect(response?.status).toBe(503);
      expect(response?.headers.get("retry-after")).toBe("5");
    });

    it("any other error is not hidden as one", async () => {
      const stwrd = stwrdFor({ ...variables }, { sessions: failing(new Error("a bug")) });
      await expect(stwrd.handle(signOutWithSession(stwrd))).rejects.toThrow("a bug");
    });
  });
});
