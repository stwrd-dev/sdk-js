// `StwrdCore` is the object every adapter builds on, so it has to behave the
// same on Node and on workerd: the sealed cookie, the derived session id, the
// session resolution that ends expired sessions, and the environment reader
// that takes its input as an argument (a Worker has no `process.env`).
import { describe, expect, it } from "vitest";

import { StwrdCore, stwrdOptionsFromEnv } from "../../src/client.js";
import { ConfigError, configFromEnv } from "../../src/config.js";
import { Keyring } from "../../src/keyring.js";
import type { StwrdSession } from "../../src/sessions.js";
import { parseCookies } from "../../src/web/cookies.js";

const OPTIONS = {
  issuer: "https://idp.example",
  clientId: "client-1",
  clientSecret: "shh",
  baseUrl: "https://app.example",
  cookieSecret: "k".repeat(32),
};
const core = (extra: Record<string, unknown> = {}) => new StwrdCore({ ...OPTIONS, ...extra });

const session = (overrides: Partial<StwrdSession> = {}): StwrdSession => {
  const now = Date.now() / 1000;
  return {
    id: "s1", sidIdp: "sid-1", sub: "usr_1", claims: { sub: "usr_1" },
    tokens: { access_token: "a", id_token: "i", token_type: "Bearer", expiresAt: now + 600 },
    expiresAt: now + 600, accessExpiresAt: now + 600, ...overrides,
  };
};

describe("StwrdCore cookie sealing", () => {
  it("round-trips a value and refuses anything it did not sign", () => {
    const stwrd = core();
    const sealed = stwrd.seal({ sid: "abc", n: "ñ€" });
    expect(stwrd.unseal(sealed)).toEqual({ sid: "abc", n: "ñ€" });
    const [payload, signature] = sealed.split(".");
    expect(stwrd.unseal(`${payload}x.${signature}`)).toBeNull();
    expect(stwrd.unseal(`${payload}.${signature}x`)).toBeNull();
    expect(stwrd.unseal(payload)).toBeNull();
    expect(stwrd.unseal("")).toBeNull();
    expect(stwrd.unseal(null)).toBeNull();
    expect(core({ cookieSecret: "z".repeat(32) }).unseal(sealed)).toBeNull();
  });

  it("derives the session id from the IdP sid and the secret, never at random", () => {
    expect(core().sessionIdForSid("sid-1")).toBe(core().sessionIdForSid("sid-1"));
    expect(core().sessionIdForSid("sid-1")).not.toBe(core().sessionIdForSid("sid-2"));
    expect(core().sessionIdForSid("sid-1")).not.toBe(core({ cookieSecret: "z".repeat(32) }).sessionIdForSid("sid-1"));
  });

  it("binds the csrf token to the session id", () => {
    const stwrd = core();
    expect(stwrd.csrf("s1")).toBe(stwrd.csrf("s1"));
    expect(stwrd.csrf("s1")).not.toBe(stwrd.csrf("s2"));
  });
});

describe("StwrdCore.resolveSession", () => {
  it("returns a live session, and null for a cookie that points nowhere", async () => {
    const stwrd = core();
    await stwrd.sessions.set(session());
    expect((await stwrd.resolveSession(stwrd.seal({ sid: "s1" })))?.id).toBe("s1");
    expect(await stwrd.resolveSession(stwrd.seal({ sid: "other" }))).toBeNull();
    expect(await stwrd.resolveSession(stwrd.seal({ nosid: true }))).toBeNull();
    expect(await stwrd.resolveSession("forged.cookie")).toBeNull();
    expect(await stwrd.resolveSession(undefined)).toBeNull();
  });

  it("ends a session past its local expiry", async () => {
    const stwrd = core();
    await stwrd.sessions.set(session({ expiresAt: Date.now() / 1000 - 1 }));
    expect(await stwrd.resolveSession(stwrd.seal({ sid: "s1" }))).toBeNull();
    expect(await stwrd.sessions.get("s1")).toBeNull();
  });

  it("ends an expired access token that has no refresh token to renew it", async () => {
    const stwrd = core();
    const past = Date.now() / 1000 - 1;
    const stored = session();
    await stwrd.sessions.set({ ...stored, accessExpiresAt: past, tokens: { ...stored.tokens, expiresAt: past } });
    expect(await stwrd.resolveSession(stwrd.seal({ sid: "s1" }))).toBeNull();
    expect(await stwrd.sessions.get("s1")).toBeNull();
  });

  it("sessionFromCookie reads the store with no side effects", async () => {
    const stwrd = core();
    await stwrd.sessions.set(session({ expiresAt: Date.now() / 1000 - 1 }));
    expect((await stwrd.sessionFromCookie(stwrd.seal({ sid: "s1" })))?.id).toBe("s1");
    expect(await stwrd.sessions.get("s1")).not.toBeNull();
  });
});

describe("the environment reaches the core as an argument", () => {
  const ENV = {
    STWRD_ISSUER: OPTIONS.issuer, STWRD_CLIENT_ID: OPTIONS.clientId, STWRD_CLIENT_SECRET: OPTIONS.clientSecret,
    STWRD_BASE_URL: OPTIONS.baseUrl, STWRD_COOKIE_SECRET: OPTIONS.cookieSecret,
  };

  it("reads a Workers-style env: strings, bare numbers and booleans, ignoring bindings it does not own", () => {
    const env = { ...ENV, STWRD_SESSION_TTL_S: 3600, STWRD_COOKIE_SECURE: false, SESSIONS: { idFromName: () => null } };
    const values = configFromEnv(env);
    expect(values).toMatchObject({ issuer: OPTIONS.issuer, sessionTtlS: 3600, cookieSecure: false });
    expect(Object.keys(values)).not.toContain("SESSIONS");
  });

  it.each([
    ["a binding object", { object: true }],
    ["null", null],
  ])("fails closed when an STWRD_ variable is %s", (_label, value) => {
    expect(() => configFromEnv({ ...ENV, STWRD_WEBHOOK_SECRET: value })).toThrow(ConfigError);
  });

  it("builds options from env, with overrides winning, and names every missing variable", () => {
    expect(stwrdOptionsFromEnv(ENV, { scope: "openid org" })).toMatchObject({ issuer: OPTIONS.issuer, scope: "openid org" });
    expect(() => stwrdOptionsFromEnv({ STWRD_ISSUER: OPTIONS.issuer })).toThrow(
      /STWRD_CLIENT_ID, STWRD_CLIENT_SECRET, STWRD_BASE_URL, STWRD_COOKIE_SECRET/,
    );
  });
});

describe("parseCookies", () => {
  it.each([
    ["a pair", "a=1", { a: "1" }],
    ["several, with spaces", "a=1;  b=2 ;c=3", { a: "1", b: "2", c: "3" }],
    ["a percent-encoded value", "a=%C3%B1", { a: "ñ" }],
    ["an undecodable value, kept raw", "a=%E0%A4%A", { a: "%E0%A4%A" }],
    ["a pair with no name", "=1; b=2", { b: "2" }],
    ["a token with no equals sign", "junk; b=2", { b: "2" }],
    ["a value with equals signs", "a=x=y", { a: "x=y" }],
    ["no header", null, {}],
    ["an empty header", "", {}],
  ])("%s", (_label, header, expected) => {
    expect(parseCookies(header as string | null)).toEqual(expected);
  });
});

describe("Keyring", () => {
  const keys = { k1: new Uint8Array(32).fill(1), k2: new Uint8Array(32).fill(2) };

  it("encrypts with the current key and decrypts with any key it holds", async () => {
    const token = await new Keyring(keys, "k1").encrypt("secret ñ");
    expect(token.split(".").length).toBe(5);
    expect(await new Keyring(keys, "k2").decrypt(token)).toBe("secret ñ");
    await expect(new Keyring({ k2: keys.k2 }, "k2").decrypt(token)).rejects.toThrow("Unknown key id.");
  });

  it("refuses a tampered token, a wrong-size key and a current id it does not hold", async () => {
    const ring = new Keyring(keys, "k1");
    const token = await ring.encrypt("x");
    const parts = token.split(".");
    parts[3] = `${parts[3].slice(0, -2)}${parts[3].endsWith("AA") ? "BB" : "AA"}`;
    await expect(ring.decrypt(parts.join("."))).rejects.toThrow();
    expect(() => new Keyring({ k1: new Uint8Array(16) }, "k1")).toThrow("exactly 32 bytes");
    expect(() => new Keyring(keys, "missing")).toThrow("current key id");
  });

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])("does not take the inherited %s for a key id", (inherited) => {
    expect(() => new Keyring(keys, inherited)).toThrow("current key id");
  });
});
