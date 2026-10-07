/**
 * `OidcClient`: unit tests over the pure/near-pure pieces, plus the
 * id_token/logout_token checks against the fake IdP's real signatures —
 * those need a real JWKS round trip to mean anything.
 */

import { describe, expect, it } from "vitest";

import {
  JWKS_DEFAULT_TTL_S,
  JWKS_TTL_CEILING_S,
  JWKS_TTL_FLOOR_S,
  LOGOUT_EVENT_URI,
  OidcClient,
  OidcError,
  _clampTtl,
  challengeS256,
  generateVerifier,
  halfHash,
  type FetchLike,
} from "@stwrd-auth/core/oidc";
import type { FakeIdp } from "../fixtures/fakeIdp.js";
import { withFakeIdp } from "./helpers.js";

function client(fetchImpl: FetchLike, issuer: string, clientId: string, clientSecret: string) {
  return new OidcClient(fetchImpl, {
    issuer,
    clientId,
    clientSecret,
    redirectUri: "https://demo.test/auth/callback",
    scope: "openid profile email offline_access",
  });
}

// --- pure helpers ------------------------------------------------------------

describe("pure helpers", () => {
  it("the PKCE challenge is recomputable from the verifier", () => {
    const verifier = generateVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43); // RFC 7636 §4.1
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challengeS256(verifier)).toBe(challengeS256(verifier));
  });

  it("verifiers are not reused", () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
  });

  it.each([
    [null, JWKS_DEFAULT_TTL_S],
    ["garbage", JWKS_DEFAULT_TTL_S],
    ["public, max-age=0", JWKS_TTL_FLOOR_S], // clamped up
    ["public, max-age=1", JWKS_TTL_FLOOR_S],
    ["public, max-age=60", 60],
    ["public, max-age=999999", JWKS_TTL_CEILING_S], // clamped down
  ])("clamps the jwks ttl to the documented bounds: %s", (cacheControl, expected) => {
    expect(_clampTtl(cacheControl)).toBe(expected);
  });

  it("half_hash differs by algorithm", () => {
    // Different digest sizes, so the two must not collide by construction.
    const token = "some-access-token";
    expect(halfHash(token, "RS256")).not.toBe(halfHash(token, "EdDSA"));
  });
});

// --- discovery + JWKS, against the fake IdP ----------------------------------

describe("discovery", () => {
  it("returns the documented endpoints", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      const discovery = await oidc.discover();
      expect(discovery.issuer).toBe(issuer);
      expect(discovery.tokenEndpoint).toBe(`${issuer}/oidc/token`);
      expect(discovery.jwksUri).toBe(`${issuer}/.well-known/jwks.json`);
      expect(discovery.endSessionEndpoint).toBeNull(); // fake_idp default: not advertised
    });
  });

  it("an unknown kid triggers an immediate refetch", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      await oidc._fetchJwks();
      const before = oidc._jwks?.fetchedAt ?? 0;
      // A `kid` the cached JWKS does not have forces `_keysetFor` to
      // refetch rather than fail closed and reject a legitimately-rotated
      // key.
      const entry = await oidc._keysetFor("some-kid-not-in-the-cache");
      expect(entry.raw.keys.some((key) => key.kid === "some-kid-not-in-the-cache")).toBe(false); // the fake IdP never minted it
      expect((oidc._jwks?.fetchedAt ?? 0) >= before).toBe(true);
    });
  });
});

// --- id_token validation ------------------------------------------------------

async function issueAndExchange(idp: FakeIdp, oidcClient: OidcClient, nonce: string, userinfo: Record<string, unknown> = {}) {
  const code = idp.issueCode({ sub: "usr_1", nonce, userinfo });
  return oidcClient.exchangeCode({ code, codeVerifier: "whatever-verifier-the-fake-ignores" });
}

describe("validateIdToken", () => {
  it("accepts a well-formed token", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      const tokenResponse = await issueAndExchange(idp, oidc, "n1", { email: "a@b.test" });
      const claims = await oidc.validateIdToken(tokenResponse.id_token as string, {
        nonce: "n1",
        accessToken: tokenResponse.access_token as string,
      });
      expect(claims.sub).toBe("usr_1");
      expect(claims.iss).toBe(issuer);
      expect(claims.aud).toEqual([idp.clientId]);
    });
  });

  it("rejects a mismatched nonce", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      const tokenResponse = await issueAndExchange(idp, oidc, "n1");
      await expect(
        oidc.validateIdToken(tokenResponse.id_token as string, {
          nonce: "not-the-same-nonce",
          accessToken: tokenResponse.access_token as string,
        }),
      ).rejects.toThrow(OidcError);
    });
  });

  it("rejects a tampered at_hash", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      const tokenResponse = await issueAndExchange(idp, oidc, "n1");
      await expect(
        oidc.validateIdToken(tokenResponse.id_token as string, {
          nonce: "n1",
          accessToken: "a-different-access-token",
        }),
      ).rejects.toThrow(OidcError);
    });
  });

  it("rejects the wrong audience", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const now = Math.floor(Date.now() / 1000);
      const token = await idp.sign({
        iss: issuer,
        aud: ["someone-elses-client"],
        sub: "usr_1",
        iat: now,
        exp: now + 3600,
        sid: "s1",
        at_hash: halfHash("at", "RS256"),
      });
      await expect(oidc.validateIdToken(token, { nonce: "n1", accessToken: "at" })).rejects.toThrow(OidcError);
    });
  });

  it("rejects an expired token", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const now = Math.floor(Date.now() / 1000);
      const token = await idp.sign({
        iss: issuer,
        aud: [idp.clientId],
        sub: "usr_1",
        iat: now - 7200,
        exp: now - 3600,
        sid: "s1",
        at_hash: halfHash("at", "RS256"),
      });
      await expect(oidc.validateIdToken(token, { nonce: "n1", accessToken: "at" })).rejects.toThrow(OidcError);
    });
  });
});

// --- logout_token validation --------------------------------------------------

function validLogoutClaims(idp: { clientId: string }, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: undefined as unknown, // filled in per-test with the real issuer
    aud: [idp.clientId],
    iat: now,
    exp: now + 120,
    jti: "logout-1",
    sid: "s1",
    events: { [LOGOUT_EVENT_URI]: {} },
    ...overrides,
  };
}

describe("validateLogoutToken", () => {
  it("accepts a well-formed token", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const token = await idp.sign({ ...validLogoutClaims(idp), iss: issuer });
      const claims = await oidc.validateLogoutToken(token);
      expect(claims.sid).toBe("s1");
      expect(claims.jti).toBe("logout-1");
    });
  });

  it.each([
    { events: { "some.other.event": {} } }, // missing the frozen event URI
    { nonce: "must-not-be-here" }, // RFC forbids `nonce` on a logout_token
    { aud: ["someone-elses-client"] },
  ])("rejects malformed claims: %j", async (overrides) => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const claims = { ...validLogoutClaims(idp, overrides), iss: issuer };
      const token = await idp.sign(claims);
      await expect(oidc.validateLogoutToken(token)).rejects.toThrow(OidcError);
    });
  });

  it("rejects a token with no jti", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const claims = { ...validLogoutClaims(idp), iss: issuer } as Record<string, unknown>;
      delete claims.jti;
      const token = await idp.sign(claims);
      await expect(oidc.validateLogoutToken(token)).rejects.toThrow(OidcError);
    });
  });

  it("rejects missing sid and sub", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const claims = { ...validLogoutClaims(idp), iss: issuer } as Record<string, unknown>;
      delete claims.sid;
      const token = await idp.sign(claims);
      await expect(oidc.validateLogoutToken(token)).rejects.toThrow(OidcError);
    });
  });
});

// --- signature verification never trusts the token's own `alg` ---------------
//
// `verifyJws` used to read `alg` straight out of the unverified header and
// hand it to `jose.jwtVerify(..., { algorithms: [alg] })` — a token signer
// choosing its own algorithm, the JWS `alg: none` attack. `SUPPORTED_ALGS`
// is now the only list ever passed to `jwtVerify`, and the header's `alg` is
// checked against it before the key is even resolved.

describe("verifyJws never trusts the token's own alg", () => {
  it("rejects alg: none on a logout_token", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const claims = { ...validLogoutClaims(idp), iss: issuer };
      const token = idp.forgeUnsigned(claims, { alg: "none" });
      await expect(oidc.validateLogoutToken(token)).rejects.toThrow(OidcError);
    });
  });

  it("rejects alg: none on an id_token", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const now = Math.floor(Date.now() / 1000);
      const token = idp.forgeUnsigned(
        {
          iss: issuer,
          aud: [idp.clientId],
          sub: "usr_1",
          iat: now,
          exp: now + 3600,
          nonce: "n1",
          sid: "s1",
          at_hash: halfHash("at", "RS256"),
        },
        { alg: "none" },
      );
      await expect(oidc.validateIdToken(token, { nonce: "n1", accessToken: "at" })).rejects.toThrow(OidcError);
    });
  });

  it("rejects an algorithm-confusion logout_token (alg says EdDSA, the kid's real key is RSA)", async () => {
    await withFakeIdp({}, async (idp, fetchImpl, issuer) => {
      const oidc = client(fetchImpl, issuer, idp.clientId, idp.clientSecret);
      await oidc.discover();
      const claims = { ...validLogoutClaims(idp), iss: issuer };
      const token = idp.forgeUnsigned(claims, { alg: "EdDSA" });
      await expect(oidc.validateLogoutToken(token)).rejects.toThrow(OidcError);
    });
  });
});
