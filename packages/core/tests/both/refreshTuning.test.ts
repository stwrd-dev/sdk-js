// `RefreshTuning`: what differs per runtime when a session is renewed, and the
// proof that the default — Node's — is exactly what the core did before it
// existed: no extra discovery request, a 50 ms poll, ten seconds of patience.
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_REFRESH_TUNING, DISCOVERY_PROBE_TIMEOUT_MS, type RefreshTuning, StwrdCore } from "../../src/client.js";
import { ConfigError } from "../../src/config.js";
import { IdpUnavailable } from "../../src/oidc.js";
import { type StwrdSession } from "../../src/sessions.js";
import { type InProcessIdp, newStwrd } from "../support/inProcessIdp.js";

const DISCOVERY = "GET /.well-known/openid-configuration";
const TOKEN = "POST /oidc/token";
const PROBING: RefreshTuning = { waitS: 10, pollDelayMs: () => 50, probeBeforeExchange: true };

/** A core signed in with a refresh token, its access token already expired. The
 * discovery document is in the cache, as it is in a Worker that has served a
 * request. `fault` makes the IdP's discovery document fail or hang. */
async function build(tuning?: RefreshTuning) {
  const fault = { discoveryDown: false, discoveryHangs: false };
  const { idp } = await newStwrd();
  const fetch = (input: string, init?: RequestInit): Promise<Response> => {
    if (input.endsWith("/.well-known/openid-configuration")) {
      if (fault.discoveryDown) return Promise.reject(new TypeError("fetch failed"));
      if (fault.discoveryHangs) {
        return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
    }
    return idp.fetch(input, init);
  };
  const stwrd = new StwrdCore(
    {
      issuer: "https://idp.example", clientId: "client-1", clientSecret: "shh", baseUrl: "https://app.example",
      cookieSecret: "k".repeat(32), scope: "openid profile email offline_access org", fetch,
    },
    tuning,
  );
  const code = idp.issueCode({ nonce: null, withRefresh: true });
  const response = await stwrd.oidc.exchangeCode({ code, codeVerifier: "verifier" }); // also caches the discovery
  const now = Date.now() / 1000;
  const session: StwrdSession = {
    id: "s1", sidIdp: null, sub: "usr_1", claims: { sub: "usr_1" },
    tokens: { access_token: response.access_token as string, id_token: response.id_token as string, token_type: "Bearer", refresh_token: response.refresh_token as string, expiresAt: now - 1 },
    expiresAt: now + 3600, accessExpiresAt: now - 1,
  };
  await stwrd.sessions.set(session);
  idp.calls.length = 0;
  return { idp, stwrd, fault, cookie: stwrd.seal({ sid: "s1" }) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the default tuning is Node's", () => {
  it("is ten seconds of patience, a constant 50 ms poll and no probe", () => {
    expect(DEFAULT_REFRESH_TUNING.waitS).toBe(10);
    expect(DEFAULT_REFRESH_TUNING.probeBeforeExchange).toBe(false);
    for (let attempt = 0; attempt < 50; attempt += 1) expect(DEFAULT_REFRESH_TUNING.pollDelayMs(attempt)).toBe(50);
  });

  it("a renewal with no tuning reads no discovery document (it is cached) and reaches the token endpoint", async () => {
    const { idp, stwrd, cookie } = await build();
    expect(await stwrd.resolveSession(cookie)).not.toBeNull();
    expect(idp.calls.filter((call) => call === DISCOVERY)).toHaveLength(0);
    expect(idp.calls.filter((call) => call === TOKEN)).toHaveLength(1);
  });

  it("an IdP whose discovery is down does not stop a renewal: nothing probes it", async () => {
    const { idp, stwrd, fault, cookie } = await build();
    fault.discoveryDown = true;
    expect(await stwrd.resolveSession(cookie)).not.toBeNull();
    expect(idp.calls.filter((call) => call === TOKEN)).toHaveLength(1);
  });
});

describe("probeBeforeExchange", () => {
  it("asks for the discovery document again, before the exchange", async () => {
    const { idp, stwrd, cookie } = await build(PROBING);
    expect(await stwrd.resolveSession(cookie)).not.toBeNull();
    const discovery = idp.calls.indexOf(DISCOVERY);
    expect(idp.calls.filter((call) => call === DISCOVERY)).toHaveLength(1);
    expect(idp.calls.indexOf(TOKEN)).toBeGreaterThan(discovery);
    expect(discovery).toBe(0);
  });

  it("marks nothing as sent when the IdP does not answer: the lease is free, the next request retries", async () => {
    const { idp, stwrd, fault, cookie } = await build(PROBING);
    fault.discoveryDown = true;
    await expect(stwrd.resolveSession(cookie)).rejects.toBeInstanceOf(IdpUnavailable);
    expect(idp.calls.filter((call) => call === TOKEN)).toHaveLength(0);
    // Not `sent`, not `uncertain`, not held: a new owner gets the refresh from the start.
    const lease = await stwrd.sessions.claimRefresh("s1", "someone", 30);
    expect(lease).toMatchObject({ status: "granted", phase: "acquired" });
    if (lease.status === "granted") await stwrd.sessions.releaseRefresh("s1", lease.fence, false);

    fault.discoveryDown = false;
    expect(await stwrd.resolveSession(cookie)).not.toBeNull();
    expect(idp.calls.filter((call) => call === TOKEN)).toHaveLength(1);
  });

  it("gives the IdP five seconds, no more", async () => {
    expect(DISCOVERY_PROBE_TIMEOUT_MS).toBe(5000);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { idp, stwrd, fault, cookie } = await build(PROBING);
    fault.discoveryHangs = true;
    let outcome: unknown = "pending";
    const renewal = stwrd.resolveSession(cookie).then((value) => (outcome = value), (error) => (outcome = error));
    await vi.advanceTimersByTimeAsync(DISCOVERY_PROBE_TIMEOUT_MS - 1);
    expect(outcome).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await renewal;
    expect(outcome).toBeInstanceOf(IdpUnavailable);
    expect(idp.calls.filter((call) => call === TOKEN)).toHaveLength(0);
    const lease = await stwrd.sessions.claimRefresh("s1", "someone", 30);
    expect(lease).toMatchObject({ status: "granted", phase: "acquired" });
  });
});

describe("polling for another owner's refresh", () => {
  /** Another owner holds the lease; after `polls` waits it finishes and the session is fresh. */
  async function waitingBehind(polls: number, tuning?: RefreshTuning) {
    const { stwrd, cookie } = await build(tuning);
    const lease = await stwrd.sessions.claimRefresh("s1", "other-owner", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    const stored = lease.session;
    const realGet = stwrd.sessions.get.bind(stwrd.sessions);
    let reads = 0;
    stwrd.sessions.get = async (id: string) => {
      reads += 1;
      if (reads === polls + 1) { // the first read is `resolveSession`'s own
        const now = Date.now() / 1000;
        await stwrd.sessions.completeRefresh(id, lease.fence, { ...stored, tokens: { ...stored.tokens, expiresAt: now + 600 }, accessExpiresAt: now + 600 });
      }
      return realGet(id);
    };
    return { stwrd, cookie };
  }

  const delaysOf = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((call: unknown[]) => call[1]).filter((delay: unknown) => typeof delay === "number" && delay < 1000);

  it("by default waits 50 ms between polls, however many", async () => {
    const { stwrd, cookie } = await waitingBehind(5);
    const spy = vi.spyOn(globalThis, "setTimeout");
    expect(await stwrd.resolveSession(cookie)).not.toBeNull();
    expect(delaysOf(spy)).toEqual([50, 50, 50, 50, 50]);
  });

  it("asks the tuning for the delay, counting polls from zero", async () => {
    const asked: number[] = [];
    const { stwrd, cookie } = await waitingBehind(5, { waitS: 10, pollDelayMs: (attempt) => (asked.push(attempt), 2 * (attempt + 1)), probeBeforeExchange: false });
    const spy = vi.spyOn(globalThis, "setTimeout");
    expect(await stwrd.resolveSession(cookie)).not.toBeNull();
    expect(asked).toEqual([0, 1, 2, 3, 4]);
    expect(delaysOf(spy)).toEqual([2, 4, 6, 8, 10]);
  });

  it("gives up after waitS and says the IdP is unavailable", async () => {
    const { stwrd, cookie } = await waitingBehind(Number.POSITIVE_INFINITY, { waitS: 0.15, pollDelayMs: () => 10, probeBeforeExchange: false });
    const started = Date.now();
    await expect(stwrd.resolveSession(cookie)).rejects.toThrow(IdpUnavailable);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a nonsense delay falls back to 50 ms instead of spinning", async () => {
    const { stwrd, cookie } = await waitingBehind(2, { waitS: 10, pollDelayMs: () => Number.NaN, probeBeforeExchange: false });
    const spy = vi.spyOn(globalThis, "setTimeout");
    expect(await stwrd.resolveSession(cookie)).not.toBeNull();
    expect(delaysOf(spy)).toEqual([50, 50]);
  });
});

describe("a tuning that makes no sense is a configuration error", () => {
  it.each<[string, unknown]>([
    ["zero patience", { waitS: 0, pollDelayMs: () => 50, probeBeforeExchange: false }],
    ["negative patience", { waitS: -1, pollDelayMs: () => 50, probeBeforeExchange: false }],
    ["NaN patience", { waitS: Number.NaN, pollDelayMs: () => 50, probeBeforeExchange: false }],
    ["no delay function", { waitS: 10, pollDelayMs: 50, probeBeforeExchange: false }],
  ])("%s", (_label, tuning) => {
    expect(() => new StwrdCore(
      { issuer: "https://idp.example", clientId: "c", clientSecret: "s", baseUrl: "https://app.example", cookieSecret: "k".repeat(32) },
      tuning as RefreshTuning,
    )).toThrow(ConfigError);
  });
});

describe("keepAlive", () => {
  // The hook a runtime that cuts a request short (Workers: `ctx.waitUntil`)
  // uses to let a renewal finish; the core awaits the renewal itself.
  const hook = () => {
    const kept: Promise<void>[] = [];
    return { kept, keepAlive: (work: Promise<void>) => void kept.push(work) };
  };

  it("hands the owned renewal over once, and the work ends only after the session is saved", async () => {
    const { idp, stwrd, cookie } = await build();
    const { kept, keepAlive } = hook();
    let settled = false;
    const renewed = await stwrd.resolveSession(cookie, keepAlive);
    expect(renewed).not.toBeNull();
    expect(kept).toHaveLength(1);
    await kept[0].then(() => (settled = true));
    expect(settled).toBe(true);
    expect(idp.calls.filter((call) => call === TOKEN)).toHaveLength(1);
    expect((await stwrd.sessions.get("s1"))?.tokens.access_token).toBe(renewed?.tokens.access_token);
  });

  it("is not asked for when there is nothing to renew", async () => {
    const { stwrd, cookie } = await build();
    const { kept, keepAlive } = hook();
    expect(await stwrd.resolveSession(cookie, keepAlive)).not.toBeNull();
    expect(await stwrd.resolveSession(cookie, keepAlive)).not.toBeNull(); // renewed already
    expect(kept).toHaveLength(1);
  });

  it("the work it is given never rejects, and the caller still sees the failure", async () => {
    const { stwrd, fault, cookie } = await build(PROBING);
    const { kept, keepAlive } = hook();
    fault.discoveryDown = true;
    await expect(stwrd.resolveSession(cookie, keepAlive)).rejects.toBeInstanceOf(IdpUnavailable);
    expect(kept).toHaveLength(1);
    await expect(kept[0]).resolves.toBeUndefined();
  });

  it("without it the renewal is exactly what it was", async () => {
    const { idp, stwrd, cookie } = await build();
    expect(await stwrd.resolveSession(cookie)).not.toBeNull();
    expect(idp.calls.filter((call) => call === TOKEN)).toHaveLength(1);
  });
});
