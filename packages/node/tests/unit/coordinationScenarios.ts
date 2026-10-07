/** Refresh must survive concurrent server workers, lost responses and logout.
 * Run against every `SessionStore` implementation, on Node and inside workerd: it builds the core
 * (no Express) and talks to the fake IdP in handler mode (no socket). */

import { describe, expect, it } from "vitest";

import { StwrdCore } from "@stwrd-auth/core/client";
import { IdpUnavailable, type FetchLike } from "@stwrd-auth/core/oidc";
import { isAccessTokenExpired, type SessionStore, type StwrdSession } from "@stwrd-auth/core/sessions";
import type { FakeIdp } from "../fixtures/fakeIdp.js";
import { BASE_URL, withFakeIdp } from "./helpers.js";

const COOKIE_SECRET = "x".repeat(32);

function build(issuer: string, idp: FakeIdp, extra: { sessions?: StwrdCore["sessions"]; fetch?: FetchLike } = {}): StwrdCore {
  return new StwrdCore({ issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, baseUrl: BASE_URL, cookieSecret: COOKIE_SECRET, fetch: idp.fetch, ...extra });
}

async function logIn(instance: StwrdCore, idp: FakeIdp): Promise<StwrdSession> {
  const code = idp.issueCode({ sub: "usr_1", withRefresh: true, idClaims: {}, userinfo: {} });
  const response = await instance.oidc.exchangeCode({ code, codeVerifier: "whatever-verifier-the-fake-ignores" });
  const now = Date.now() / 1000;
  const sid = (idp.userinfoFor(response.access_token as string)?.sid as string) ?? "";
  const session: StwrdSession = {
    id: instance.sessionIdForSid(sid), sidIdp: sid, sub: "usr_1", claims: { sub: "usr_1" },
    tokens: { access_token: response.access_token as string, id_token: response.id_token as string, token_type: "Bearer", expiresAt: now - 1, refresh_token: response.refresh_token as string },
    expiresAt: now + 8 * 3600, accessExpiresAt: now - 1,
  };
  await instance.sessions.set(session);
  return session;
}

const isRefresh = (input: string, init?: RequestInit) => input.endsWith("/oidc/token") && String(init?.body).includes("grant_type=refresh_token");

/** Holds refresh requests until `release()`; `entered` resolves on the first. */
function hold(inner: FetchLike) {
  let release!: () => void;
  let entered!: () => void;
  const open = new Promise<void>(resolve => (release = resolve));
  const reached = new Promise<void>(resolve => (entered = resolve));
  const impl: FetchLike = async (input, init) => {
    if (isRefresh(input, init)) { entered(); await open; }
    return inner(input, init);
  };
  return { impl, release, reached };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** A session that expired its lease in phase `sent` and was seen `uncertain` by a second claimer. */
async function uncertainSession(store: SessionStore) {
  const now = Date.now() / 1000;
  const session: StwrdSession = {
    id: "late-owner", sidIdp: "sid-late", sub: "usr_1", claims: { sub: "usr_1" },
    tokens: { access_token: "a", id_token: "i", token_type: "Bearer", expiresAt: now - 1, refresh_token: "r" },
    expiresAt: now + 3600, accessExpiresAt: now - 1,
  };
  await store.set(session);
  const first = await store.claimRefresh(session.id, "a", 0.05);
  if (first.status !== "granted") throw new Error("the first claim must be granted");
  expect(await store.markRefreshSent(session.id, first.fence)).toBe(true);
  await sleep(150);
  expect(await store.claimRefresh(session.id, "b", 30)).toEqual({ status: "uncertain" });
  return { session, fence: first.fence };
}

export function coordinationScenarios(label: string, makeStore: () => SessionStore | undefined): void {
  describe(`refresh coordination (${label})`, () => {
    it("two instances exchange a single-use refresh at most once", async () => {
      await withFakeIdp({ mode: "handler" }, async (idp, _f, issuer) => {
        const first = build(issuer, idp, { sessions: makeStore() });
        const session = await logIn(first, idp);
        const held = hold(idp.fetch);
        const slow = build(issuer, idp, { sessions: first.sessions, fetch: held.impl });
        const peer = build(issuer, idp, { sessions: first.sessions });
        const cookie = first.seal({ sid: session.id });
        const one = slow.resolveSession(cookie);
        await held.reached;
        const two = peer.resolveSession(cookie);
        await new Promise(resolve => setTimeout(resolve, 150));
        held.release();
        const results = await Promise.all([one, two]);
        expect(idp.refreshCalls.length).toBe(1);
        expect(results.every(result => result !== null)).toBe(true);
        const stored = await first.sessions.get(session.id);
        expect(stored?.tokens.refresh_token).not.toBe(session.tokens.refresh_token);
      });
    });

    it("logout during refresh cannot resurrect the deleted session", async () => {
      await withFakeIdp({ mode: "handler" }, async (idp, _f, issuer) => {
        const base = build(issuer, idp, { sessions: makeStore() });
        const session = await logIn(base, idp);
        const held = hold(idp.fetch);
        const slow = build(issuer, idp, { sessions: base.sessions, fetch: held.impl });
        const pending = slow.resolveSession(base.seal({ sid: session.id }));
        await held.reached;
        await base.sessions.delete(session.id);
        held.release();
        expect(await pending).toBeNull();
        expect(idp.refreshCalls.length).toBe(1);
        expect(await base.sessions.get(session.id)).toBeNull();
      });
    });

    it("a lost response after rotation never replays the consumed refresh", async () => {
      await withFakeIdp({ mode: "handler" }, async (idp, _f, issuer) => {
        const base = build(issuer, idp, { sessions: makeStore() });
        const session = await logIn(base, idp);
        let lost = false;
        const lossy: FetchLike = async (input, init) => {
          const response = await idp.fetch(input, init);
          if (isRefresh(input, init) && !lost) { lost = true; throw new TypeError("response lost after processing"); }
          return response;
        };
        const broken = build(issuer, idp, { sessions: base.sessions, fetch: lossy });
        const cookie = base.seal({ sid: session.id });
        await expect(broken.resolveSession(cookie)).rejects.toBeInstanceOf(IdpUnavailable);
        await expect(broken.resolveSession(cookie)).rejects.toBeInstanceOf(IdpUnavailable);
        expect(idp.refreshCalls.length).toBe(1);
        expect(await base.sessions.get(session.id)).not.toBeNull();
      });
    });

    it("a request that provably never left is retried safely", async () => {
      await withFakeIdp({ mode: "handler" }, async (idp, _f, issuer) => {
        const base = build(issuer, idp, { sessions: makeStore() });
        const session = await logIn(base, idp);
        let refused = false;
        const flaky: FetchLike = async (input, init) => {
          if (isRefresh(input, init) && !refused) {
            refused = true;
            throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
          }
          return idp.fetch(input, init);
        };
        const instance = build(issuer, idp, { sessions: base.sessions, fetch: flaky });
        const cookie = base.seal({ sid: session.id });
        await expect(instance.resolveSession(cookie)).rejects.toBeInstanceOf(IdpUnavailable);
        expect(idp.refreshCalls.length).toBe(0);
        expect(await instance.resolveSession(cookie)).not.toBeNull();
        expect(idp.refreshCalls.length).toBe(1);
      });
    });

    it("userinfo recovery uses checkpointed tokens without another rotation", async () => {
      await withFakeIdp({ mode: "handler" }, async (idp, _f, issuer) => {
        const base = build(issuer, idp, { sessions: makeStore() });
        const session = await logIn(base, idp);
        let failed = false;
        const flaky: FetchLike = async (input, init) => {
          if (input.endsWith("/oidc/userinfo") && !failed) { failed = true; throw new TypeError("userinfo unavailable"); }
          return idp.fetch(input, init);
        };
        const instance = build(issuer, idp, { sessions: base.sessions, fetch: flaky });
        const cookie = base.seal({ sid: session.id });
        await expect(instance.resolveSession(cookie)).rejects.toBeInstanceOf(IdpUnavailable);
        const restored = await instance.resolveSession(cookie);
        expect(restored).not.toBeNull();
        expect(idp.refreshCalls.length).toBe(1);
        expect(restored && isAccessTokenExpired(restored)).toBe(false);
      });
    });

    it("a lost lease never deletes a recreated session", async () => {
      await withFakeIdp({ mode: "handler" }, async (idp, _f, issuer) => {
        const base = build(issuer, idp, { sessions: makeStore() });
        const session = await logIn(base, idp);
        const held = hold(idp.fetch);
        const slow = build(issuer, idp, { sessions: base.sessions, fetch: held.impl });
        const pending = slow.resolveSession(base.seal({ sid: session.id }));
        await held.reached;
        await base.sessions.set(session); // the person signed in again with the same sid
        held.release();
        await expect(pending).rejects.toBeInstanceOf(IdpUnavailable);
        expect(await base.sessions.get(session.id)).not.toBeNull();
      });
    });

    it("a late release of the owner never reopens an uncertain session", async () => {
      const store = makeStore() as SessionStore;
      const { session, fence } = await uncertainSession(store);
      await store.releaseRefresh(session.id, fence, true);
      expect(await store.claimRefresh(session.id, "c", 30)).toEqual({ status: "uncertain" });
      await store.releaseRefresh(session.id, fence, false); // even one that says nothing was sent
      expect(await store.claimRefresh(session.id, "d", 30)).toEqual({ status: "uncertain" });
    });

    it("a late owner cannot complete the refresh of an uncertain session", async () => {
      const store = makeStore() as SessionStore;
      const { session, fence } = await uncertainSession(store);
      expect(await store.completeRefresh(session.id, fence, { ...session, claims: { sub: "usr_1", name: "late" } })).toBe(false);
      expect((await store.get(session.id))?.claims).toEqual({ sub: "usr_1" });
      expect(await store.claimRefresh(session.id, "c", 30)).toEqual({ status: "uncertain" });
    });
  });
}
