// What a failed network call says about whether the request left. Node's
// `fetch` carries `error.cause.code` (ECONNREFUSED proves nothing was sent);
// workerd's does not, so there every network failure must count as "may have
// been sent" (`requestSent: true`). That is what makes a refresh whose
// exchange died `uncertain` instead of replaying a possibly consumed refresh
// token. The expectation is per runtime on purpose: inverting it is the lock.
import { inject, describe, expect, it } from "vitest";

import { IdpUnavailable, OidcClient } from "../../src/oidc.js";
import { RUNTIME } from "../support/runtime.js";

const params = (issuer: string) => ({
  issuer, clientId: "client-1", clientSecret: "shh", redirectUri: "https://app.example/cb", scope: "openid",
});

const EXPECTED_REQUEST_SENT = { node: false, workerd: true } as const;

describe(`network failures on ${RUNTIME}`, () => {
  it("a refused connection says requestSent per runtime", async () => {
    const port = inject("ports").closed;
    const client = new OidcClient((url, init) => fetch(url, init), params(`http://127.0.0.1:${port}`));
    const failure = await client.discover().catch((exc: unknown) => exc);
    expect(failure).toBeInstanceOf(IdpUnavailable);
    expect((failure as IdpUnavailable).requestSent).toBe(EXPECTED_REQUEST_SENT[RUNTIME]);
  });

  it.each([
    ["an error without cause", () => new TypeError("boom"), true],
    ["a cause the network layer does not recognise", () => Object.assign(new TypeError("boom"), { cause: { code: "ECONNRESET" } }), true],
    ["a refused connection reported through cause.code", () => Object.assign(new TypeError("boom"), { cause: { code: "ECONNREFUSED" } }), false],
  ])("%s -> requestSent %s", async (_label, make, requestSent) => {
    const client = new OidcClient(async () => { throw make(); }, params("https://idp.example"));
    const failure = await client.discover().catch((exc: unknown) => exc);
    expect(failure).toBeInstanceOf(IdpUnavailable);
    expect((failure as IdpUnavailable).requestSent).toBe(requestSent);
  });

  it("an IdP saying 'not now' (503) frees the request on both runtimes", async () => {
    const client = new OidcClient(async () => new Response("later", { status: 503 }), params("https://idp.example"));
    const failure = await client.discover().catch((exc: unknown) => exc);
    expect((failure as IdpUnavailable).requestSent).toBe(false);
  });
});
