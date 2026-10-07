/**
 * The server renews tokens on its own, and when a membership is removed the
 * refresh fails and the local session ends. Runs against `FakeIdp`'s real
 * `grant_type=refresh_token` branch: a real HTTP round trip, not a mock of
 * `OidcClient`.
 *
 * **Renewal can fail in two different ways.** A rejection by the identity
 * provider (revoked, reused, family gone) ends the local session. A provider
 * that does not answer (no connection, or a 5xx) ends nothing and raises
 * `IdpUnavailable`. Treating both alike would sign out everyone who was
 * renewing during any provider hiccup.
 */

import { describe, expect, it } from "vitest";

import { Stwrd, createStwrd } from "../../src/client.js";
import { IdpUnavailable } from "@stwrd-auth/core/oidc";
import { isAccessTokenExpired, type StwrdSession } from "@stwrd-auth/core/sessions";
import type { FakeIdp } from "../fixtures/fakeIdp.js";
import { BASE_URL, withFakeIdp } from "./helpers.js";

const ISSUER_COOKIE_SECRET = "x".repeat(32);

function buildStwrd(issuer: string, idp: FakeIdp): Stwrd {
  return createStwrd({
    issuer,
    clientId: idp.clientId,
    clientSecret: idp.clientSecret,
    baseUrl: BASE_URL,
    cookieSecret: ISSUER_COOKIE_SECRET,
    fetch,
  });
}

async function logInWithRefresh(
  instance: Stwrd,
  idp: FakeIdp,
  options: { sub?: string; accessExpiresInS?: number; userinfo?: Record<string, unknown> } = {},
): Promise<StwrdSession> {
  const sub = options.sub ?? "usr_1";
  const code = idp.issueCode({ sub, withRefresh: true, idClaims: Object.fromEntries(Object.entries(options.userinfo ?? {}).filter(([k]) => k.startsWith("org_"))), userinfo: options.userinfo ?? {} });
  const tokenResponse = await instance.oidc.exchangeCode({ code, codeVerifier: "whatever-verifier-the-fake-ignores" });
  const now = Date.now() / 1000;
  const accessExpiresInS = options.accessExpiresInS ?? 3600;
  const sid = (idp.userinfoFor(tokenResponse.access_token as string)?.sid as string) ?? "";
  const session: StwrdSession = {
    id: instance.sessionIdForSid(sid),
    sidIdp: sid,
    sub,
    claims: { sub, ...(options.userinfo ?? {}) },
    tokens: {
      access_token: tokenResponse.access_token as string,
      id_token: tokenResponse.id_token as string,
      token_type: "Bearer",
      expiresAt: now + accessExpiresInS,
      refresh_token: tokenResponse.refresh_token as string,
    },
    expiresAt: now + 8 * 3600,
    accessExpiresAt: now + accessExpiresInS,
  };
  await instance.sessions.set(session);
  return session;
}

describe("resolveSession renewal", () => {
  it("an expired access token with a refresh token renews transparently", async () => {
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1, userinfo: { email: "a@b.test" } });
      const oldAccessToken = session.tokens.access_token;

      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));

      expect(resolved).not.toBeNull();
      expect(resolved && resolved.accessExpiresAt > Date.now() / 1000).toBe(true);
      expect(resolved?.tokens.access_token).not.toBe(oldAccessToken);
      expect(idp.refreshCalls.length).toBe(1);
    });
  });

  it("the renewed session is persisted through the store", async () => {
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1 });

      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));
      expect(resolved).not.toBeNull();

      const stored = await instance.sessions.get(session.id);
      expect(stored?.tokens.access_token).toBe(resolved?.tokens.access_token);
    });
  });

  it("userinfo is refetched on renewal so a lost membership disappears", async () => {
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, {
        accessExpiresInS: -1,
        userinfo: { org_id: "org-1", org_display_name: "Team", org_roles: ["org:admin"], org_permissions: [] },
      });
      // The membership was pulled between login and this renewal — the
      // fake's userinfo answer for the NEW access token no longer carries it.
      const entry = idp.refreshEntryFor(session.tokens.refresh_token as string);
      expect(entry).toBeDefined();
      if (entry) {
        entry.idClaims = {};
        entry.userinfo = Object.fromEntries(
          Object.entries(entry.userinfo).filter(([key]) => !key.startsWith("org_")),
        );
      }

      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));
      expect(resolved).not.toBeNull();
      expect(resolved?.claims.org_id).toBeUndefined();
    });
  });

  it("a rejected refresh ends the local session", async () => {
    // When the refresh fails, the local session ends and the application
    // sees "no session". Exercised against the fake's real invalid_grant
    // response.
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1 });
      idp.refreshStatusCode = 400;

      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));
      expect(resolved).toBeNull();
      expect(await instance.sessions.get(session.id)).toBeNull();
    });
  });

  // The ways the identity provider **does not answer**. They are one case for
  // the SDK, hence one table: the fetch throws, or it returns a 5xx. The
  // second is the one that bites in practice (a loaded provider answering 502
  // through the edge), and a plain `catch` around the fetch does not see it.
  const SILENCES: Array<[string, () => Promise<Response>]> = [
    [
      "the fetch throws",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["the provider answers 502 through the edge", async () => new Response("bad gateway", { status: 502 })],
    ["the provider answers 503", async () => new Response("unavailable", { status: 503 })],
    // The three 4xx statuses that are not a rejection either
    // (`RETRY_STATUSES`). 429 is the one that bites: the token endpoint limit
    // applies per `client_id`, so a large relying party that crosses it would
    // sign out everyone renewing, and the signed-out users go to `/authorize`,
    // amplifying the load that triggered the limit.
    ["the provider times out (408)", async () => new Response("timeout", { status: 408 })],
    ["too early (425)", async () => new Response("too early", { status: 425 })],
    ["the token endpoint limit (429)", async () => new Response("slow_down", { status: 429 })],
  ];

  for (const [name, broken] of SILENCES) {
    it(`a provider that does not answer does NOT end the local session (${name})`, async () => {
      // **Silence is not a rejection**, and that is the whole property.
      // Treating "the provider did not answer" like a revoked refresh token
      // would delete the session in both cases, and any provider hiccup would
      // sign out everyone who was renewing.
      //
      // The two halves matter separately: the call **raises** instead of
      // returning `null` (returning `null` means "no session", the falsehood
      // that signs people out), and **the session stays in the store**, which
      // is what lets the next attempt renew unnoticed. What it must NOT do is
      // serve the old claims.
      await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
        const instance = buildStwrd(issuer, idp);
        const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1 });

        // A second `Stwrd` on the SAME store, with a silent provider, so that
        // what is exercised is the renewal and not the login.
        const brokenInstance = createStwrd({
          issuer,
          clientId: idp.clientId,
          clientSecret: idp.clientSecret,
          baseUrl: BASE_URL,
          cookieSecret: ISSUER_COOKIE_SECRET,
          sessions: instance.sessions,
          fetch: broken,
        });

        await expect(
          brokenInstance.resolveSession(instance.seal({ sid: session.id })),
        ).rejects.toBeInstanceOf(IdpUnavailable);
        expect(await instance.sessions.get(session.id)).not.toBeNull();
      });
    });
  }

  it("silence AFTER the exchange never leaves the consumed refresh token in the store", async () => {
    // The exchange succeeds (the provider already rotated the token, so the
    // old refresh token is consumed) and only then `userinfo` goes silent. If
    // the session kept the old token, the next attempt would be a REUSE, which
    // kills the whole token family and raises the standard token-theft alarm.
    //
    // The early checkpoint also has to store the NEW expiry together with the
    // cleared claims. Otherwise the next attempt would see the access token as
    // still valid and never query `userinfo` again, and someone who lost a
    // membership during the outage would keep seeing it for up to an hour.
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, {
        accessExpiresInS: -1,
        userinfo: { org_id: "org-1", org_display_name: "Team", org_roles: ["org:admin"], org_permissions: [] },
      });
      const consumed = session.tokens.refresh_token;

      const original = instance.oidc.userinfo.bind(instance.oidc);
      instance.oidc.userinfo = async () => {
        throw new IdpUnavailable("userinfo: the IdP did not respond (test).");
      };
      try {
        await expect(
          instance.resolveSession(instance.seal({ sid: session.id })),
        ).rejects.toBeInstanceOf(IdpUnavailable);
      } finally {
        instance.oidc.userinfo = original;
      }

      const stored = await instance.sessions.get(session.id);
      expect(stored, "the session was deleted although the provider rejected nothing").not.toBeNull();
      expect(
        stored?.tokens.refresh_token,
        "the store kept the refresh token that the exchange ALREADY consumed",
      ).not.toBe(consumed);
      expect(
        stored && isAccessTokenExpired(stored),
        "the early checkpoint marked the access token as valid: the next " +
          "attempt would not renew again and would serve the old claims",
      ).toBe(true);

      // The retry only repeats `userinfo` with the stored tokens: exchanging
      // the refresh token again would be a REUSE (the store's lease contract).
      // The authority claims come from the id_token that the exchange returned.
      const renewed = await instance.resolveSession(instance.seal({ sid: session.id }));
      expect(renewed).not.toBeNull();
      expect(idp.refreshCalls.length).toBe(1);
      expect(renewed && isAccessTokenExpired(renewed)).toBe(false);
    });
  });

  // A 200 that lacks what `renew` needs is not silence (the provider did
  // answer), so it is a REJECTION like any other: the session ends and
  // nothing throws up to the caller.
  const MALFORMED_BODIES: Array<[string, Record<string, unknown>]> = [
    ["no access_token", { token_type: "Bearer" }],
    ["non-numeric expires_in", { access_token: "tok", expires_in: "soon" }],
  ];

  for (const [name, body] of MALFORMED_BODIES) {
    it(`a malformed exchange body ends the session without throwing (${name})`, async () => {
      await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
        const instance = buildStwrd(issuer, idp);
        const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1 });

        const original = instance.oidc.exchangeRefreshToken.bind(instance.oidc);
        instance.oidc.exchangeRefreshToken = async () => body;
        let resolved: StwrdSession | null;
        try {
          resolved = await instance.resolveSession(instance.seal({ sid: session.id }));
        } finally {
          instance.oidc.exchangeRefreshToken = original;
        }

        expect(resolved).toBeNull();
        expect(await instance.sessions.get(session.id)).toBeNull();
      });
    });
  }

  it("the session renews normally as soon as the provider is back", async () => {
    // What matters to the application's user is that the outage was a gap and
    // not an ending. Without this, "does not delete the session" could coexist
    // with an unusable session and the test would still pass.
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1 });
      const brokenInstance = createStwrd({
        issuer,
        clientId: idp.clientId,
        clientSecret: idp.clientSecret,
        baseUrl: BASE_URL,
        cookieSecret: ISSUER_COOKIE_SECRET,
        sessions: instance.sessions,
        // A refused connection provably never reached the IdP, so the lease is
        // released and the next request retries; an error without a
        // connection-phase `cause.code` would count as "may have been sent".
        fetch: async () => {
          throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
        },
      });

      await expect(
        brokenInstance.resolveSession(instance.seal({ sid: session.id })),
      ).rejects.toBeInstanceOf(IdpUnavailable);

      // The provider is back: the same session, through the healthy instance.
      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe(session.id);
    });
  });

  it("a successful renewal slides the local session ttl forward", async () => {
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1 });
      // Move the session close to the end of its local window — exactly
      // the case a non-sliding TTL would let expire out from under
      // someone mid-use even though the refresh that just happened
      // succeeded.
      const nearExpiry = Date.now() / 1000 + 5;
      await instance.sessions.set({ ...session, expiresAt: nearExpiry });

      const before = Date.now() / 1000;
      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));

      expect(resolved).not.toBeNull();
      expect(resolved && resolved.expiresAt > nearExpiry).toBe(true);
      expect(resolved && resolved.expiresAt >= before + instance.config.sessionTtlS - 5).toBe(true);

      const stored = await instance.sessions.get(session.id);
      expect(stored?.expiresAt).toBe(resolved?.expiresAt);
    });
  });

  it("a live access token is served without touching the network", async () => {
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, { accessExpiresInS: 3600 });

      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));
      expect(resolved?.tokens.access_token).toBe(session.tokens.access_token);
      expect(idp.refreshCalls).toEqual([]);
    });
  });

  it("without offline_access, expiry ends the session instead of renewing", async () => {
    // The F1 shape is unchanged for a session that never got a
    // refresh_token in the first place.
    await withFakeIdp({}, async (idp, _fetchImpl, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const code = idp.issueCode({ sub: "usr_1", withRefresh: false });
      const tokenResponse = await instance.oidc.exchangeCode({ code, codeVerifier: "whatever-verifier-the-fake-ignores" });
      const now = Date.now() / 1000;
      const session: StwrdSession = {
        id: "s-no-refresh",
        sidIdp: "sid-1",
        sub: "usr_1",
        claims: { sub: "usr_1" },
        tokens: {
          access_token: tokenResponse.access_token as string,
          id_token: tokenResponse.id_token as string,
          token_type: "Bearer",
          expiresAt: now - 1,
        },
        expiresAt: now + 3600,
        accessExpiresAt: now - 1,
      };
      await instance.sessions.set(session);

      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));
      expect(resolved).toBeNull();
      expect(idp.refreshCalls).toEqual([]);
      expect(await instance.sessions.get(session.id)).toBeNull();
    });
  });
});

describe("fresh verified authority", () => {
  it.each(["missing", "removed", "individual"])("replaces old org authority on refresh: %s", async mode => {
    await withFakeIdp({}, async (idp, _fetch, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1, userinfo: {
        org_id: "old", org_display_name: "Old", org_roles: ["admin"], org_permissions: ["write"],
      }});
      const exchange = instance.oidc.exchangeRefreshToken.bind(instance.oidc);
      instance.oidc.exchangeRefreshToken = async refresh => {
        const entry = idp.refreshEntryFor(refresh)!;
        entry.idClaims = mode === "individual" ? { roles: ["reader"], permissions: ["read"] } : {};
        entry.userinfo.consents = { terms: "pending" };
        entry.userinfo.sid = "injected";
        const response = await exchange(refresh);
        if (mode === "missing") delete response.id_token;
        return response;
      };
      const resolved = await instance.resolveSession(instance.seal({ sid: session.id }));
      expect(resolved).not.toBeNull();
      expect(resolved?.claims.org_id).toBeUndefined();
      expect(resolved?.claims.roles).toEqual(mode === "individual" ? ["reader"] : undefined);
      expect(resolved?.sidIdp).toBe(session.sidIdp);
      expect(resolved?.claims.sid).not.toBe("injected");
      expect(resolved?.claims.consents).toEqual({ terms: "pending" });
    });
  });
  it.each(["id_token", "userinfo"])("a changed subject in %s terminates the local session", async source => {
    await withFakeIdp({}, async (idp, _fetch, issuer) => {
      const instance = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(instance, idp, { accessExpiresInS: -1 });
      const entry = idp.refreshEntryFor(session.tokens.refresh_token!)!;
      if (source === "id_token") entry.sub = "attacker";
      else entry.userinfo.sub = "attacker";
      expect(await instance.resolveSession(instance.seal({ sid: session.id }))).toBeNull();
      expect(await instance.sessions.get(session.id)).toBeNull();
    });
  });
});

describe("durable pending refresh", () => {
  it("a second worker sees cleared authority after userinfo silence and finishes with the checkpointed credentials", async () => {
    await withFakeIdp({}, async (idp, _fetch, issuer) => {
      const first = buildStwrd(issuer, idp);
      const session = await logInWithRefresh(first, idp, { accessExpiresInS: -1, userinfo: { roles: ["admin"], permissions: ["write"] } });
      first.oidc.userinfo = async () => { throw new IdpUnavailable("outage"); };
      const cookie = first.seal({ sid: session.id });
      await expect(first.resolveSession(cookie)).rejects.toBeInstanceOf(IdpUnavailable);
      const staged = await first.sessions.get(session.id);
      expect(staged?.claims.roles).toBeUndefined();
      expect(staged?.claims.permissions).toBeUndefined();
      expect(staged?.tokens.refresh_token).not.toBe(session.tokens.refresh_token);
      const second = createStwrd({ issuer, clientId: idp.clientId, clientSecret: idp.clientSecret,
        baseUrl: BASE_URL, cookieSecret: ISSUER_COOKIE_SECRET, sessions: first.sessions, fetch });
      const refreshed = await second.resolveSession(cookie);
      expect(refreshed).not.toBeNull();
      expect(refreshed?.claims.roles).toBeUndefined();
      // The retry only repeats userinfo with the checkpointed tokens: exchanging again would be a reuse.
      expect(idp.refreshCalls).toEqual([session.tokens.refresh_token]);
    });
  });
});
