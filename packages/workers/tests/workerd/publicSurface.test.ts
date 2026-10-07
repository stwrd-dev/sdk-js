/**
 * `@stwrd-auth/workers`: the public surface, name by name. One row per
 * name in `SURFACE`, and the runtime exports have to be EXACTLY those rows: a
 * new export is a new row (a contract to keep), a removed one is a break. The
 * type names are checked by `tsc` (this file is part of `npm run lint`), and the
 * package manifest is pinned for what the contract says about it.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import core from "../../../core/package.json" with { type: "json" };
import manifest from "../../package.json" with { type: "json" };
import * as sdk from "../../src/index.js";
import type {
  AccessContext, AccessResult, AccessRule, BackChannelSink, Claims, ConsentState, DurableObjectSessionStoreOptions, FetchLike,
  GuardOptions, ObjectClaim, ProtectOptions, RefreshClaim, Resolution, SessionContext, SessionObjects, SessionResponse, SessionStore,
  StwrdOrganization, StwrdSession, StwrdUser, Tokens, WebhookEvent, WorkersOptions,
} from "../../src/index.js";

const SURFACE = [
  // the adapter
  "stwrdFor",
  "StwrdWorkers",
  "SESSIONS_BINDING",
  "VERSION",
  // sessions
  "StwrdSessionObject",
  "DurableObjectSessionStore",
  "SESSION_OBJECT_PREFIX",
  "UNNAMED_NOTICE_OBJECT",
  "parseSessionKeys",
  "SESSION_KEYS_ENV",
  // from the core
  "ConfigError",
  "Keyring",
  "IdpUnavailable",
  "OidcError",
  "RefreshUncertain",
  "MemoryStore",
  "contextFromClaims",
  "hasPermission",
  "hasRole",
  "sessionContext",
  "sessionResponse",
  "userFromClaims",
  "safeTarget",
];

describe("@stwrd-auth/workers public surface", () => {
  it.each(SURFACE)("exports %s", (name) => {
    expect(sdk).toHaveProperty(name);
    expect((sdk as Record<string, unknown>)[name]).toBeDefined();
  });

  it("has no constructor for a back-channel sink: it comes from the store, which fixes the namespace", () => {
    expect(sdk).not.toHaveProperty("DurableObjectBackChannelSink");
  });

  it("exports nothing else", () => {
    expect(Object.keys(sdk).sort()).toEqual([...SURFACE].sort());
  });

  it("VERSION is the package version", () => {
    expect(sdk.VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(sdk.VERSION).toBe(manifest.version);
  });

  it("exports the type names the documentation uses", () => {
    expectTypeOf<[
      AccessContext, AccessResult, AccessRule, BackChannelSink, Claims, ConsentState, DurableObjectSessionStoreOptions, FetchLike,
      GuardOptions, ObjectClaim, ProtectOptions, RefreshClaim, Resolution, SessionContext, SessionObjects, SessionResponse, SessionStore,
      StwrdOrganization, StwrdSession, StwrdUser, Tokens, WebhookEvent, WorkersOptions,
    ]>().not.toBeAny();
  });
});

describe("StwrdWorkers instance surface", () => {
  it("carries every documented property and method", () => {
    const instance = sdk.stwrdFor(
      { STWRD_ISSUER: "https://auth.example.com", STWRD_CLIENT_ID: "c1", STWRD_CLIENT_SECRET: "s", STWRD_BASE_URL: "https://app.test", STWRD_COOKIE_SECRET: "x".repeat(32) },
      { sessions: new sdk.MemoryStore() },
    );
    for (const attribute of ["config", "oidc", "sessions", "seenWebhookIds"]) {
      expect(instance).toHaveProperty(attribute);
    }
    for (const method of [
      "handle", "protect", "resolve", "requireAuth", "requireRole", "requirePermission", "requireOrg",
      "seal", "unseal", "csrf", "sessionIdForSid", "resolveSession", "sessionFromCookie",
      "organizationSelectionEnabled", "listOrganizations", "verifyWebhook",
    ]) {
      expect(typeof (instance as unknown as Record<string, unknown>)[method]).toBe("function");
    }
  });
});

describe("the package manifest", () => {
  it("exposes only the entry point", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });

  it("depends on exactly one runtime package, `@stwrd-auth/core`, at its exact version", () => {
    expect(manifest.dependencies).toEqual({ "@stwrd-auth/core": core.version });
    expect(core.version).toMatch(/^\d+\.\d+\.\d+$/); // an exact version, not a range
  });

  it("is versioned with the core", () => {
    expect(manifest.version).toBe(core.version);
  });
});
