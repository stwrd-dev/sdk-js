/**
 * The refresh tuning exists for the Workers adapter; `@stwrd-auth/node` has to stay
 * exactly what it was: same constructor, same discovery handling, same poll.
 * The tuning's own behavior is pinned in `@stwrd-auth/core`
 * (`tests/both/refreshTuning.test.ts`).
 */

import { describe, expect, it } from "vitest";

import { Stwrd } from "../../src/client.js";
import type { StwrdSession } from "@stwrd-auth/core/sessions";
import { BASE_URL, withFakeIdp } from "./helpers.js";

describe("@stwrd-auth/node and the refresh tuning", () => {
  it("the constructor takes the options and nothing else", () => {
    expect(Stwrd.length).toBe(1);
  });

  it("a second constructor argument, a tuning that probes, changes nothing: no discovery request before the exchange", async () => {
    await withFakeIdp({ mode: "handler" }, async (idp, _fetch, issuer) => {
      const requests: string[] = [];
      const fetchImpl = (input: string, init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${new URL(input).pathname}`);
        return idp.fetch(input, init);
      };
      const options = { issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, baseUrl: BASE_URL, cookieSecret: "x".repeat(32), fetch: fetchImpl };
      const probing = { waitS: 10, pollDelayMs: () => 50, probeBeforeExchange: true };
      const stwrd = new (Stwrd as unknown as new (options: object, tuning: object) => Stwrd)(options, probing);

      const code = idp.issueCode({ sub: "usr_1", withRefresh: true });
      const response = await stwrd.oidc.exchangeCode({ code, codeVerifier: "verifier" });
      const now = Date.now() / 1000;
      const session: StwrdSession = {
        id: "s1", sidIdp: null, sub: "usr_1", claims: { sub: "usr_1" },
        tokens: { access_token: response.access_token as string, id_token: response.id_token as string, token_type: "Bearer", refresh_token: response.refresh_token as string, expiresAt: now - 1 },
        expiresAt: now + 3600, accessExpiresAt: now - 1,
      };
      await stwrd.sessions.set(session);
      requests.length = 0;

      expect(await stwrd.resolveSession(stwrd.seal({ sid: "s1" }))).not.toBeNull();
      expect(requests.filter((request) => request.endsWith("/.well-known/openid-configuration"))).toEqual([]);
      expect(requests.filter((request) => request === "POST /oidc/token")).toHaveLength(1);
    });
  });
});
