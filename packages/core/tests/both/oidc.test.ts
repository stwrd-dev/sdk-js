// The same `id_token`, per signing algorithm, is accepted or rejected the
// same way on Node and on workerd. Keys are generated here (no fixtures to go
// stale) and the IdP is an in-process `FetchLike`. `SUPPORTED_ALGS` is
// RS256 and EdDSA only: an ES256 token must be refused, on both runtimes.
import * as jose from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { halfHash, OidcClient, OidcError } from "../../src/oidc.js";

const ISSUER = "https://idp.example";
const CLIENT_ID = "client-1";
const NONCE = "n-1";
const ACCESS_TOKEN = "access-token-xyz";

const ALGORITHMS = [
  { alg: "RS256", accepted: true, options: {} },
  { alg: "EdDSA", accepted: true, options: { crv: "Ed25519" } },
  { alg: "ES256", accepted: false, options: {} },
] as const;

interface Issued {
  readonly jwk: jose.JWK;
  readonly token: string;
}

async function issue(alg: string, options: { crv?: string }, claims: Record<string, unknown> = {}): Promise<Issued> {
  const { publicKey, privateKey } = await jose.generateKeyPair(alg, { extractable: true, ...options });
  const kid = `k-${alg}`;
  const jwk = { ...(await jose.exportJWK(publicKey)), kid, alg, use: "sig" };
  const now = Math.floor(Date.now() / 1000);
  const token = await new jose.SignJWT({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: "u1",
    iat: now - 5,
    exp: now + 3600,
    nonce: NONCE,
    at_hash: halfHash(ACCESS_TOKEN, alg),
    ...claims,
  })
    .setProtectedHeader({ alg, kid })
    .sign(privateKey);
  return { jwk, token };
}

function idpFetch(keys: jose.JWK[]) {
  return async (url: string): Promise<Response> => {
    const path = new URL(url).pathname;
    if (path === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (path === "/jwks") return Response.json({ keys }, { headers: { "cache-control": "public, max-age=60" } });
    return new Response("not found", { status: 404 });
  };
}

const client = (keys: jose.JWK[]) =>
  new OidcClient(idpFetch(keys), { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: "shh", redirectUri: "https://app.example/auth/callback", scope: "openid" });

describe.each(ALGORITHMS)("id_token signed with $alg", ({ alg, accepted, options }) => {
  let issued: Issued;
  beforeAll(async () => {
    issued = await issue(alg, options);
  });

  it(accepted ? "is accepted" : "is rejected as an unsupported algorithm", async () => {
    const result = client([issued.jwk]).validateIdToken(issued.token, { nonce: NONCE, accessToken: ACCESS_TOKEN });
    if (accepted) {
      expect((await result).sub).toBe("u1");
    } else {
      await expect(result).rejects.toBeInstanceOf(OidcError);
    }
  });

  it("is rejected when the signature is altered", async () => {
    const [header, payload, signature] = issued.token.split(".");
    const flipped = signature.startsWith("A") ? "B" + signature.slice(1) : "A" + signature.slice(1);
    await expect(
      client([issued.jwk]).validateIdToken(`${header}.${payload}.${flipped}`, { nonce: NONCE, accessToken: ACCESS_TOKEN }),
    ).rejects.toBeInstanceOf(OidcError);
  });

  it("is rejected when signed by a key the IdP does not publish", async () => {
    const stranger = await issue(alg, options);
    await expect(
      client([issued.jwk]).validateIdToken(stranger.token, { nonce: NONCE, accessToken: ACCESS_TOKEN }),
    ).rejects.toBeInstanceOf(OidcError);
  });
});

describe("claims checks hold on both runtimes", () => {
  let issued: Issued;
  beforeAll(async () => {
    issued = await issue("EdDSA", { crv: "Ed25519" });
  });

  it.each([
    ["another nonce", { nonce: "other", accessToken: ACCESS_TOKEN }, /nonce/],
    ["another access token (at_hash)", { nonce: NONCE, accessToken: "different" }, /at_hash/],
  ])("rejects %s", async (_label, options, message) => {
    await expect(client([issued.jwk]).validateIdToken(issued.token, options)).rejects.toThrow(message);
  });

  it("rejects another audience", async () => {
    const other = new OidcClient(idpFetch([issued.jwk]), {
      issuer: ISSUER, clientId: "someone-else", clientSecret: "shh", redirectUri: "https://app.example/cb", scope: "openid",
    });
    await expect(other.validateIdToken(issued.token, { nonce: NONCE, accessToken: ACCESS_TOKEN })).rejects.toThrow(/aud/);
  });
});
