/**
 * Every name of the public surface must really be importable. One test per
 * property, parametrized over the whole surface table: a name added to the
 * package adds a row here, not a new test function.
 */

import { describe, expect, it } from "vitest";

import * as sdk from "../../src/index.js";

// Every public name of `@stwrd-auth/node`, letter for letter.
const SURFACE = [
  "createStwrd",
  "Stwrd",
  "MemoryStore",
  "csrfToken",
  "sign",
  "unsign",
  "userFromClaims",
  "contextFromClaims",
  "sessionContext",
  "sessionResponse",
  "hasRole",
  "hasPermission",
  "accessExpiry",
  "OidcClient",
  "OidcError",
  "newAuthorizationState",
  "generateVerifier",
  "challengeS256",
  "halfHash",
  "verifyWebhook",
  "verifyWebhookSignature",
  "signWebhook",
  "SeenEventIds",
  "HEADER_ID",
  "HEADER_TIMESTAMP",
  "HEADER_SIGNATURE",
  "SIGNATURE_PREFIX",
  "TOLERANCE_S",
  "DEDUP_WINDOW_S",
  "configFromEnv",
  "resolveConfig",
  "ConfigError",
  "ENV_PREFIX",
  "REQUIRED_ENV",
  "COOKIE_SECRET_MIN_LEN",
  "VERSION",
  // Express wiring — `.attach()`/`.authRouter()`/`.protectAll()` are `Stwrd`
  // methods (covered by the instance-surface test below); these are the
  // free-function guards.
  "requireAuth",
  "apiMode",
  "requireRole",
  "requireOrg",
  "requirePermission",
  "safeTarget",
  // Additional helper, kept for parity with the Python SDK's `safe_equal`;
  // see the module comment of `webhooks.ts`.
  "safeEqual",
  // Developing against a local identity provider.
  "makeHostFetch",
  "DuplicateEventError",
  "InvalidSignatureError",
];

describe("@stwrd-auth/node public surface", () => {
  it.each(SURFACE)("exports %s", (name) => {
    expect(sdk).toHaveProperty(name);
    expect((sdk as Record<string, unknown>)[name]).toBeDefined();
  });

  it("VERSION is a semver-shaped string", () => {
    expect(sdk.VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("Stwrd instance surface", () => {
  it("carries every documented property and method", () => {
    const instance = sdk.createStwrd({
      issuer: "https://auth.example.com",
      clientId: "c1",
      clientSecret: "secret",
      baseUrl: "https://demo.test",
      cookieSecret: "x".repeat(32),
    });
    for (const attribute of ["config", "oidc", "sessions", "seenWebhookIds"]) {
      expect(instance).toHaveProperty(attribute);
    }
    for (const method of [
      "seal",
      "unseal",
      "csrf",
      "resolveSession",
      "resolveSessionFromRequest",
      "sessionFromCookie",
      "sessionFromRequest",
      "attach",
      "authRouter",
      "verifyWebhook",
      "protectAll",
    ]) {
      expect(typeof (instance as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });
});
