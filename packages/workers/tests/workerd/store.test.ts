// `DurableObjectSessionStore` against the contract of every `SessionStore`:
// the shared coordination scenarios, a step-by-step comparison with the
// in-memory store, and what only this store has to prove (the object never
// holds a readable session, an envelope is bound to its place, a store that
// does not answer is not "no session").
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { Keyring } from "@stwrd-auth/core/keyring";
import { IdpUnavailable } from "@stwrd-auth/core/oidc";
import { MemoryStore, type SessionStore, type StwrdSession, type Tokens } from "@stwrd-auth/core/sessions";
import { coordinationScenarios } from "../../../node/tests/unit/coordinationScenarios.js";
import { DurableObjectSessionStore, type SessionObjects, sessionObjectName } from "../../src/store.js";

const KEYS = { k1: new Uint8Array(32).fill(49), k2: new Uint8Array(32).fill(50) };
const SECRETS = ["access-secret", "refresh-secret", "id-secret", "usr_1"];

const tokens = (expiresInS = 3600): Tokens => ({
  access_token: "access-secret",
  id_token: "id-secret",
  token_type: "Bearer",
  refresh_token: "refresh-secret",
  expiresAt: Date.now() / 1000 + expiresInS,
});
const session = (id = "s1"): StwrdSession => ({
  id,
  sidIdp: "sid1",
  sub: "usr_1",
  claims: { sub: "usr_1", org_id: "o", name: "old" },
  tokens: tokens(),
  expiresAt: Date.now() / 1000 + 3600,
  accessExpiresAt: Date.now() / 1000 - 1,
});
const fresh = (keyring = new Keyring(KEYS, "k1"), namespace = `tenant-${crypto.randomUUID()}/client`, onUnreadable?: (e: unknown) => void) => ({
  namespace,
  keyring,
  onUnreadable,
  store: new DurableObjectSessionStore(env.STWRD_SESSIONS, { namespace, keyring, onUnreadable }),
});
const rawObject = (namespace: string, id: string) => env.STWRD_SESSIONS.get(env.STWRD_SESSIONS.idFromName(sessionObjectName(namespace, id)));

coordinationScenarios("durable object", () => fresh().store);

describe("DurableObjectSessionStore", () => {
  it("round-trips, and the object only ever holds an encrypted envelope", async () => {
    const { store, namespace } = fresh();
    const original = session();
    await store.set(original);
    expect(await store.get("s1")).toEqual(original);
    const envelope = (await rawObject(namespace, "s1").get()) as string;
    for (const secret of SECRETS) expect(envelope).not.toContain(secret);
    expect(envelope.split(".")).toHaveLength(5); // a compact JWE
    await store.delete("s1");
    expect(await store.get("s1")).toBeNull();
  });

  it("an envelope moved to another id or another namespace is not a session", async () => {
    const unreadable = vi.fn();
    const { store, keyring, namespace } = fresh(undefined, undefined, undefined);
    await store.set(session("s1"));
    const envelope = (await rawObject(namespace, "s1").get()) as string;

    const sameNamespace = fresh(keyring, namespace, unreadable).store;
    await rawObject(namespace, "renamed").set(envelope, Date.now() / 1000 + 3600);
    expect(await sameNamespace.get("renamed")).toBeNull();

    const otherNamespace = `${namespace}-other`;
    const other = fresh(keyring, otherNamespace, unreadable).store;
    await rawObject(otherNamespace, "s1").set(envelope, Date.now() / 1000 + 3600);
    expect(await other.get("s1")).toBeNull();
    expect(unreadable).toHaveBeenCalledTimes(2);
  });

  it("two namespaces with the same session id never share an object", async () => {
    const unreadable = vi.fn();
    const keyring = new Keyring(KEYS, "k1");
    const one = fresh(keyring, `https://idp.test|client-${crypto.randomUUID()}`, unreadable).store;
    const two = fresh(keyring, `https://idp.test|client-${crypto.randomUUID()}`, unreadable).store;
    await one.set({ ...session("shared-sid"), sub: "usr_one" });
    expect(await two.get("shared-sid")).toBeNull();
    await two.set({ ...session("shared-sid"), sub: "usr_two" });
    expect((await one.get("shared-sid"))?.sub).toBe("usr_one"); // not overwritten
    await two.delete("shared-sid");
    expect((await one.get("shared-sid"))?.sub).toBe("usr_one"); // not deleted
    expect(unreadable).not.toHaveBeenCalled(); // never even read the other's envelope
  });

  it("a tampered envelope, or one whose key is gone, is not a session", async () => {
    const unreadable = vi.fn();
    const { store, namespace } = fresh();
    await store.set(session("s1"));
    const envelope = (await rawObject(namespace, "s1").get()) as string;
    const parts = envelope.split(".");
    const flipped = `${parts[3].slice(0, -2)}${parts[3].endsWith("AA") ? "BB" : "AA"}`;
    await rawObject(namespace, "tampered").set([...parts.slice(0, 3), flipped, parts[4]].join("."), Date.now() / 1000 + 3600);
    const reader = fresh(new Keyring(KEYS, "k1"), namespace, unreadable).store;
    expect(await reader.get("tampered")).toBeNull();
    await rawObject(namespace, "garbage").set("not-a-jwe", Date.now() / 1000 + 3600);
    expect(await reader.get("garbage")).toBeNull();
    const withoutKey = fresh(new Keyring({ k2: KEYS.k2 }, "k2"), namespace, unreadable).store;
    expect(await withoutKey.get("s1")).toBeNull();
    expect(unreadable).toHaveBeenCalledTimes(3);
  });

  it("rotates keys: the first encrypts, every one decrypts", async () => {
    const { store, namespace } = fresh(new Keyring({ k1: KEYS.k1 }, "k1"));
    await store.set(session("s1"));
    const rotated = fresh(new Keyring(KEYS, "k2"), namespace).store;
    expect((await rotated.get("s1"))?.sub).toBe("usr_1"); // k1 still reads
    await rotated.set(session("s2"));
    const onlyOld = fresh(new Keyring({ k1: KEYS.k1 }, "k1"), namespace, () => undefined).store;
    expect(await onlyOld.get("s2")).toBeNull(); // written under k2
  });

  it("an unreadable envelope cannot hold a lease", async () => {
    const { store, namespace } = fresh();
    await rawObject(namespace, "garbage").set("not-a-jwe", Date.now() / 1000 + 3600);
    const reader = fresh(new Keyring(KEYS, "k1"), namespace, () => undefined).store;
    expect(await reader.claimRefresh("garbage", "a", 30)).toEqual({ status: "gone" });
    expect(await rawObject(namespace, "garbage").claim("b", 30)).toMatchObject({ status: "granted" }); // the lease was given back
    void store;
  });

  describe("replaceSession", () => {
    it("retires the old session and installs the new one", async () => {
      const { store } = fresh();
      await store.set(session("old"));
      expect(await store.replaceSession("old", session("new"))).toBe(true);
      expect(await store.get("old")).toBeNull();
      expect((await store.get("new"))?.id).toBe("new");
    });

    it("writes nothing when the old session was deleted meanwhile (a logout is never undone)", async () => {
      const { store } = fresh();
      expect(await store.replaceSession("gone", session("new"))).toBe(false);
      expect(await store.get("new")).toBeNull();
    });
  });

  describe("an object that does not answer", () => {
    // Every call of the object fails, the way a Durable Object that is over
    // its limit or being reset fails: the store has to say it does not know,
    // never "there is no session".
    const broken = (): SessionObjects =>
      new Proxy(env.STWRD_SESSIONS, {
        get(target, property) {
          if (property !== "get") return Reflect.get(target, property).bind?.(target) ?? Reflect.get(target, property);
          return () =>
            new Proxy({}, { get: () => () => Promise.reject(new Error("Durable Object reset because its code was updated")) });
        },
      });
    const store = () => new DurableObjectSessionStore(broken(), { namespace: "ns", keyring: new Keyring(KEYS, "k1") });

    it.each<[string, (s: SessionStore) => Promise<unknown>]>([
      ["get", (s) => s.get("s1")],
      ["set", (s) => s.set(session("s1"))],
      ["delete", (s) => s.delete("s1")],
      ["replaceSession", (s) => s.replaceSession("s0", session("s1"))],
      ["claimRefresh", (s) => s.claimRefresh("s1", "a", 30)],
      ["markRefreshSent", (s) => s.markRefreshSent("s1", 1)],
      ["checkpointRefresh", (s) => s.checkpointRefresh("s1", 1, tokens(), false)],
      ["completeRefresh", (s) => s.completeRefresh("s1", 1, session("s1"))],
      ["releaseRefresh", (s) => s.releaseRefresh("s1", 1, false)],
    ])("%s raises IdpUnavailable", async (_name, run) => {
      await expect(run(store())).rejects.toBeInstanceOf(IdpUnavailable);
    });
  });
});

// The decision table, step by step, against the in-memory store: the same
// script has to give the same answers (fences compared by what they do, not by value).
type Step =
  | ["set"]
  | ["claim", owner: string, leaseS: number]
  | ["sent", who: string]
  | ["checkpoint", who: string, fresh: boolean]
  | ["complete", who: string]
  | ["release", who: string, sent: boolean]
  | ["get"]
  | ["delete"];

const SCRIPTS: Array<[string, Step[]]> = [
  ["a refresh that completes", [["set"], ["claim", "a", 30], ["claim", "b", 30], ["sent", "a"], ["checkpoint", "a", true], ["complete", "a"], ["claim", "b", 30]]],
  ["an expired lease at `acquired` is taken over", [["set"], ["claim", "a", 0], ["claim", "b", 30], ["sent", "a"], ["sent", "b"]]],
  ["an expired lease at `sent` is `uncertain` for good", [["set"], ["claim", "a", 0], ["sent", "a"], ["claim", "b", 30], ["claim", "c", 30], ["set"], ["claim", "d", 30]]],
  ["a release that sent nothing", [["set"], ["claim", "a", 30], ["release", "a", false], ["claim", "b", 30], ["sent", "b"], ["release", "b", false], ["claim", "c", 30]]],
  ["a release that may have sent", [["set"], ["claim", "a", 30], ["sent", "a"], ["release", "a", true], ["claim", "b", 30]]],
  ["a hydrating lease is resumed", [["set"], ["claim", "a", 30], ["sent", "a"], ["checkpoint", "a", false], ["release", "a", true], ["claim", "b", 30], ["complete", "b"], ["claim", "c", 30]]],
  ["a checkpoint needs `sent`", [["set"], ["claim", "a", 30], ["checkpoint", "a", false], ["sent", "a"], ["checkpoint", "a", false], ["checkpoint", "a", false]]],
  ["a stale owner after a new session", [["set"], ["claim", "a", 30], ["set"], ["sent", "a"], ["complete", "a"], ["claim", "b", 30]]],
  ["a delete ends everything", [["set"], ["claim", "a", 30], ["delete"], ["sent", "a"], ["complete", "a"], ["claim", "b", 30], ["get"]]],
  ["no session", [["claim", "a", 30], ["get"], ["delete"]]],
];

async function play(store: SessionStore, steps: Step[]): Promise<unknown[]> {
  const fences = new Map<string, number>();
  const out: unknown[] = [];
  for (const [name, ...args] of steps) {
    if (name === "set") out.push(await store.set(session("s1")));
    else if (name === "get") out.push(((await store.get("s1")) !== null));
    else if (name === "delete") out.push(await store.delete("s1"));
    else if (name === "claim") {
      const claim = await store.claimRefresh("s1", args[0] as string, args[1] as number);
      if (claim.status === "granted") {
        fences.set(args[0] as string, claim.fence);
        out.push({ status: claim.status, phase: claim.phase, freshIdToken: claim.freshIdToken });
      } else out.push(claim);
    } else {
      const fence = fences.get(args[0] as string) ?? -1;
      if (name === "sent") out.push(await store.markRefreshSent("s1", fence));
      else if (name === "checkpoint") out.push(await store.checkpointRefresh("s1", fence, tokens(), args[1] as boolean));
      else if (name === "complete") out.push(await store.completeRefresh("s1", fence, session("s1")));
      else if (name === "release") out.push(await store.releaseRefresh("s1", fence, args[1] as boolean));
    }
  }
  return out;
}

describe("the lease table is the in-memory store's", () => {
  it.each(SCRIPTS)("%s", async (_label, steps) => {
    expect(await play(fresh().store, steps)).toEqual(await play(new MemoryStore(), steps));
  });
});
