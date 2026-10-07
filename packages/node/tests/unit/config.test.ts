/**
 * Config resolution: fail-closed construction. `STWRD_COOKIE_SECRET` has a
 * minimum of 32 characters, checked when the configuration is built.
 */

import { describe, expect, it } from "vitest";

import {
  COOKIE_SECRET_MIN_LEN,
  ConfigError,
  DEFAULT_SCOPE,
  type StwrdConfigOptions,
  configFromEnv,
  resolveConfig,
} from "@stwrd-auth/core/config";

const VALID: StwrdConfigOptions = {
  issuer: "https://auth.example.com",
  clientId: "demo",
  clientSecret: "s3cret",
  baseUrl: "https://demo.test",
  cookieSecret: "x".repeat(32),
};

describe("resolveConfig", () => {
  it("builds with the required fields", () => {
    const config = resolveConfig(VALID);
    expect(config.scope).toBe(DEFAULT_SCOPE);
    expect(config.cookieSecure).toBe(true);
  });

  it.each(["issuer", "clientId", "clientSecret", "baseUrl", "cookieSecret"] as const)(
    "refuses a missing required field: %s",
    (missing) => {
      expect(() => resolveConfig({ ...VALID, [missing]: "" })).toThrow(ConfigError);
    },
  );

  it("refuses a short cookie secret", () => {
    expect(() => resolveConfig({ ...VALID, cookieSecret: "x".repeat(COOKIE_SECRET_MIN_LEN - 1) })).toThrow(
      ConfigError,
    );
  });

  it("accepts a cookie secret at the minimum length", () => {
    expect(() => resolveConfig({ ...VALID, cookieSecret: "x".repeat(COOKIE_SECRET_MIN_LEN) })).not.toThrow();
  });

  it("computes derived urls", () => {
    const config = resolveConfig(VALID);
    expect(config.redirectUri).toBe("https://demo.test/auth/callback");
    expect(config.postLogoutRedirectUri).toBe("https://demo.test/");
    expect(config.accountUrl).toBe("https://auth.example.com/me");
  });

  it("oidc() carries no secret beyond clientSecret", () => {
    const config = resolveConfig({ ...VALID, webhookSecret: "whsec-x" });
    const params = config.oidc();
    expect(params.clientId).toBe("demo");
    expect(params.redirectUri).toBe(config.redirectUri);
    expect((params as unknown as Record<string, unknown>).webhookSecret).toBeUndefined();
    expect((params as unknown as Record<string, unknown>).cookieSecret).toBeUndefined();
  });

  it("replace() builds a new object, the original untouched", () => {
    const config = resolveConfig(VALID);
    const other = config.replace({ scope: "openid" });
    expect(other.scope).toBe("openid");
    expect(config.scope).toBe(DEFAULT_SCOPE);
  });

  it("rejects sessionTtlS/transactionTtlS that are not positive", () => {
    expect(() => resolveConfig({ ...VALID, sessionTtlS: 0 })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...VALID, transactionTtlS: -1 })).toThrow(ConfigError);
  });

  // `NaN <= 0` is false, so a NaN TTL used to pass the check and then never
  // expire (`now > NaN` is always false): fail closed instead.
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["negative", -5],
    ["fractional", 1.5],
  ])("rejects a %s sessionTtlS or transactionTtlS", (_label, value) => {
    expect(() => resolveConfig({ ...VALID, sessionTtlS: value })).toThrow(ConfigError);
    expect(() => resolveConfig({ ...VALID, transactionTtlS: value })).toThrow(ConfigError);
  });

  it("rejects a prefix that does not start with /", () => {
    expect(() => resolveConfig({ ...VALID, prefix: "auth" })).toThrow(ConfigError);
  });
});

describe("configFromEnv", () => {
  it("reads STWRD_-prefixed variables", () => {
    const env = {
      STWRD_ISSUER: "https://auth.example.com",
      STWRD_CLIENT_ID: "demo",
      STWRD_CLIENT_SECRET: "s3cret",
      STWRD_BASE_URL: "https://demo.test",
      STWRD_COOKIE_SECRET: "x".repeat(32),
      STWRD_COOKIE_SECURE: "false",
    };
    const values = configFromEnv(env as unknown as NodeJS.ProcessEnv);
    expect(values.issuer).toBe("https://auth.example.com");
    expect(values.cookieSecure).toBe(false);
  });

  it("returns an empty bag on an empty environment", () => {
    expect(configFromEnv({} as NodeJS.ProcessEnv)).toEqual({});
  });

  it("parses sessionTtlS as an integer", () => {
    const values = configFromEnv({ STWRD_SESSION_TTL_S: "1200" } as unknown as NodeJS.ProcessEnv);
    expect(values.sessionTtlS).toBe(1200);
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["non-numeric", "abc"],
    ["trailing garbage", "12abc"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["decimal", "1.5"],
    ["exponent", "1e3"],
  ])("fails closed on a %s STWRD_SESSION_TTL_S", (_label, raw) => {
    expect(() => configFromEnv({ STWRD_SESSION_TTL_S: raw } as unknown as NodeJS.ProcessEnv)).toThrow(
      ConfigError,
    );
  });

  it.each([
    ["zero", "0"],
    ["negative", "-5"],
    ["overflowing to Infinity", "9".repeat(400)],
  ])("rejects a %s STWRD_SESSION_TTL_S once resolved", (_label, raw) => {
    const values = configFromEnv({ STWRD_SESSION_TTL_S: raw } as unknown as NodeJS.ProcessEnv);
    expect(() => resolveConfig({ ...VALID, ...values })).toThrow(ConfigError);
  });
});
