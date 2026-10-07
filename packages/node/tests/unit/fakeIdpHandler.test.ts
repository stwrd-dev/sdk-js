/** The fake IdP in handler mode: the same routes with no socket, so the same
 * scenarios can run inside workerd. */

import { createServer } from "node:http";
import { describe, expect, it } from "vitest";

import { HANDLER_ISSUER, FakeIdp } from "../fixtures/fakeIdp.js";

const options = { clientId: "c", clientSecret: "s", redirectUri: "https://app.test/auth/callback" };

describe("FakeIdp handler mode", () => {
  it("answers discovery, the JWKS and a token exchange through fetch, with no port opened", async () => {
    const idp = new FakeIdp({ ...options, mode: "handler" });
    const issuer = await idp.start();
    expect(issuer).toBe(HANDLER_ISSUER);
    expect(idp.localOrigin).toBe("");

    const discovery = await (await idp.fetch(`${issuer}/.well-known/openid-configuration`)).json();
    expect(discovery.token_endpoint).toBe(`${issuer}/oidc/token`);
    const jwks = await (await idp.fetch(discovery.jwks_uri)).json();
    expect(jwks.keys).toHaveLength(1);

    const code = idp.issueCode({ sub: "usr_1", nonce: "n" });
    const token = await idp.fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: "c", client_secret: "s", redirect_uri: options.redirectUri }).toString(),
    });
    expect(token.status).toBe(200);
    expect((await token.json()).access_token).toBeTruthy();
    expect((await idp.fetch(`${issuer}/nope`)).status).toBe(404);
    await idp.stop();
  });

  it("honors publicIssuer", async () => {
    const idp = new FakeIdp({ ...options, mode: "handler", publicIssuer: "https://auth.example.com" });
    expect(await idp.start()).toBe("https://auth.example.com");
  });

  it("server mode serves the same routes over loopback TCP and keeps its port", async () => {
    const idp = new FakeIdp(options);
    const issuer = await idp.start();
    try {
      expect(issuer).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const response = await fetch(`${issuer}/.well-known/openid-configuration`);
      expect(response.status).toBe(200);
      expect((await response.json()).issuer).toBe(issuer);
      expect(typeof createServer).toBe("function");
    } finally {
      await idp.stop();
    }
  });
});
