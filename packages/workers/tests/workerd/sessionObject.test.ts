// The Durable Object that keeps one session, called the way the Worker calls
// it: through a stub, in workerd. The lease table is the one of the PostgreSQL
// and in-memory stores; `store.test.ts` runs the shared coordination
// scenarios and checks the three against each other.
import { env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { type ObjectClaim, StwrdSessionObject } from "../../src/sessionObject.js";

const nameOf = () => `object-${crypto.randomUUID()}`;
const objectNamed = (name = nameOf()) => env.STWRD_SESSIONS.get(env.STWRD_SESSIONS.idFromName(name));
const inOneHour = () => Date.now() / 1000 + 3600;

function granted(claim: ObjectClaim) {
  if (claim.status !== "granted") throw new Error(`expected a grant, got ${claim.status}`);
  return claim;
}

async function withSession(payload = "envelope-1") {
  const stub = objectNamed();
  await stub.set(payload, inOneHour());
  return stub;
}

describe("the envelope", () => {
  it("round-trips, and is gone after delete", async () => {
    const stub = objectNamed();
    expect(await stub.get()).toBeNull();
    await stub.set("envelope-1", inOneHour());
    expect(await stub.get()).toBe("envelope-1");
    await stub.set("envelope-2", inOneHour());
    expect(await stub.get()).toBe("envelope-2");
    await stub.delete();
    expect(await stub.get()).toBeNull();
  });

  it("is per object: another name is another session", async () => {
    const [one, two] = [await withSession("one"), await withSession("two")];
    await one.delete();
    expect(await two.get()).toBe("two");
  });

  it("retire deletes only what is there and says so", async () => {
    const stub = await withSession();
    expect(await stub.retire()).toBe(true);
    expect(await stub.get()).toBeNull();
    expect(await stub.retire()).toBe(false);
  });
});

describe("claim", () => {
  it("is gone with no session", async () => {
    expect(await objectNamed().claim("a", 30)).toEqual({ status: "gone" });
  });

  it("grants the first caller at `acquired` and makes the second wait", async () => {
    const stub = await withSession();
    const first = granted(await stub.claim("a", 30));
    expect(first).toMatchObject({ payload: "envelope-1", phase: "acquired", freshIdToken: false });
    expect(await stub.claim("b", 30)).toEqual({ status: "busy" });
  });

  it("re-grants an expired lease under a new fence", async () => {
    const stub = await withSession();
    const first = granted(await stub.claim("a", 0));
    const second = granted(await stub.claim("b", 30));
    expect(second.fence).toBeGreaterThan(first.fence);
    expect(await stub.markSent(first.fence)).toBe(false); // the old owner is fenced out
  });

  it("turns an expired lease that had sent the request into `uncertain`, for good", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 0));
    expect(await stub.markSent(lease.fence)).toBe(true);
    expect(await stub.claim("b", 30)).toEqual({ status: "uncertain" });
    expect(await stub.claim("c", 30)).toEqual({ status: "uncertain" });
    expect(await stub.complete(lease.fence, "late", inOneHour())).toBe(false);
    await stub.set("envelope-2", inOneHour()); // a new sign-in is the way out
    granted(await stub.claim("d", 30));
  });

  it("resumes `hydrating` with the checkpoint and the flag", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 0));
    expect(await stub.markSent(lease.fence)).toBe(true);
    expect(await stub.checkpoint(lease.fence, "rotated", true)).toBe(true);
    expect(granted(await stub.claim("b", 30))).toMatchObject({ phase: "hydrating", payload: "rotated", freshIdToken: true });
  });
});

describe("the steps under a lease", () => {
  it("markSent needs the live fence and the `acquired` phase", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 30));
    expect(await stub.markSent(lease.fence + 1)).toBe(false);
    expect(await stub.markSent(lease.fence)).toBe(true);
    expect(await stub.markSent(lease.fence)).toBe(false); // already `sent`
  });

  it("checkpoint needs `sent`; complete needs a live lease and ends it", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 30));
    expect(await stub.checkpoint(lease.fence, "rotated", false)).toBe(false); // nothing was sent
    expect(await stub.markSent(lease.fence)).toBe(true);
    expect(await stub.checkpoint(lease.fence, "rotated", false)).toBe(true);
    expect(await stub.complete(lease.fence, "final", inOneHour())).toBe(true);
    expect(await stub.get()).toBe("final");
    expect(await stub.complete(lease.fence, "again", inOneHour())).toBe(false); // the lease ended
    granted(await stub.claim("b", 30)); // and nobody holds it
  });

  it("a new session under the same id fences out the old owner", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 30));
    await stub.set("envelope-2", inOneHour());
    expect(await stub.markSent(lease.fence)).toBe(false);
    expect(await stub.complete(lease.fence, "stale", inOneHour())).toBe(false);
    expect(await stub.get()).toBe("envelope-2");
  });

  it("a deleted session cannot be resurrected by its owner", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 30));
    await stub.delete();
    expect(await stub.markSent(lease.fence)).toBe(false);
    expect(await stub.complete(lease.fence, "stale", inOneHour())).toBe(false);
    expect(await stub.get()).toBeNull();
  });

  it("the fence only grows, across a delete and across the storage being emptied", async () => {
    const stub = objectNamed();
    await stub.set("a", inOneHour());
    const first = granted(await stub.claim("a", 30)).fence;
    await stub.delete();
    await stub.set("b", inOneHour());
    const second = granted(await stub.claim("a", 30)).fence;
    expect(second).toBeGreaterThan(first);
    await stub.set("c", Date.now() / 1000 - 1);
    await runDurableObjectAlarm(stub); // expired: the alarm empties the storage
    await stub.set("d", inOneHour());
    expect(granted(await stub.claim("a", 30)).fence).toBeGreaterThan(second);
  });
});

describe("release", () => {
  it("clears a lease that sent nothing, in `acquired` and in `sent`", async () => {
    const stub = await withSession();
    const first = granted(await stub.claim("a", 30));
    await stub.release(first.fence, false);
    const second = granted(await stub.claim("b", 30));
    expect(await stub.markSent(second.fence)).toBe(true);
    await stub.release(second.fence, false); // sent: false: provably never left
    expect(granted(await stub.claim("c", 30)).phase).toBe("acquired");
  });

  it("marks `uncertain` a lease that may have sent", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 30));
    await stub.markSent(lease.fence);
    await stub.release(lease.fence, true);
    expect(await stub.claim("b", 30)).toEqual({ status: "uncertain" });
  });

  it("keeps the checkpoint of a `hydrating` lease for a retry, and frees it at once", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 30));
    await stub.markSent(lease.fence);
    await stub.checkpoint(lease.fence, "rotated", true);
    await stub.release(lease.fence, true);
    expect(granted(await stub.claim("b", 30))).toMatchObject({ phase: "hydrating", payload: "rotated" });
  });

  it("ignores a fence that is not the live one", async () => {
    const stub = await withSession();
    const lease = granted(await stub.claim("a", 30));
    await stub.release(lease.fence + 7, false);
    expect(await stub.claim("b", 30)).toEqual({ status: "busy" });
  });
});

describe("back-channel logout", () => {
  it("deletes the session and remembers the jti; a replay deletes nothing", async () => {
    const stub = await withSession();
    expect(await stub.logout("jti-1", inOneHour())).toBe("terminated");
    expect(await stub.get()).toBeNull();
    await stub.set("signed-in-again", inOneHour());
    expect(await stub.logout("jti-1", inOneHour())).toBe("replay");
    expect(await stub.get()).toBe("signed-in-again");
  });

  it("marks the jti even when there is no session, and forgets it once it cannot validate anyway", async () => {
    const stub = objectNamed();
    expect(await stub.logout("jti-2", Date.now() / 1000 - 1)).toBe("terminated");
    expect(await stub.logout("jti-2", inOneHour())).toBe("terminated"); // already past its own exp
    expect(await stub.logout("jti-2", inOneHour())).toBe("replay");
  });
});

describe("forgetting", () => {
  const tableCount = (stub: ReturnType<typeof objectNamed>) =>
    runInDurableObject(stub, (_instance: StwrdSessionObject, state: DurableObjectState) =>
      state.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'seen', 'counter')").one().n,
    );

  it("the alarm at the expiry deletes the session and the storage with it", async () => {
    const stub = objectNamed();
    await stub.set("envelope-1", Date.now() / 1000 - 1);
    await runDurableObjectAlarm(stub);
    expect(await tableCount(stub)).toBe(0);
    expect(await stub.get()).toBeNull();
  });

  // Everything that only looks (and the lease calls, which have nothing to
  // act on) answers for an object with no session without creating a table: a
  // read of an id nobody signed in under, or of a session already forgotten,
  // must not make storage that then lives forever with nothing in it.
  it.each([
    ["never written", async () => objectNamed()],
    [
      "emptied by its alarm",
      async () => {
        const stub = objectNamed();
        await stub.set("envelope-1", Date.now() / 1000 - 1);
        await runDurableObjectAlarm(stub);
        return stub;
      },
    ],
  ])("an object %s stays without storage when it is read", async (_label, make) => {
    const stub = await make();
    expect(await stub.get()).toBeNull();
    expect(await stub.claim("a", 30)).toEqual({ status: "gone" });
    expect(await stub.markSent(1)).toBe(false);
    expect(await stub.checkpoint(1, "x", false)).toBe(false);
    expect(await stub.complete(1, "x", inOneHour())).toBe(false);
    await stub.release(1, true);
    await stub.delete();
    expect(await stub.retire()).toBe(false);
    expect(await tableCount(stub)).toBe(0);
    // and it still works when somebody does sign in
    await stub.set("again", inOneHour());
    expect(await stub.get()).toBe("again");
    expect(await tableCount(stub)).toBe(3);
  });

  it("a session not yet expired survives its alarm, and the alarm stays set", async () => {
    const stub = await withSession();
    await runDurableObjectAlarm(stub);
    expect(await stub.get()).toBe("envelope-1");
    expect(await runInDurableObject(stub, (_instance: StwrdSessionObject, state: DurableObjectState) => state.storage.getAlarm())).not.toBeNull();
  });

  it("a remembered jti keeps the object alive until it expires", async () => {
    const stub = objectNamed();
    await stub.logout("jti-3", inOneHour());
    await runDurableObjectAlarm(stub);
    expect(await stub.logout("jti-3", inOneHour())).toBe("replay");
  });
});

describe("the methods are synchronous", () => {
  // An `await` inside a method is where another call can get in (the spike saw
  // it with timers and `fetch`): the state machine has none. Only `alarm`, at
  // its very end, awaits the emptying of the storage.
  const names = Object.getOwnPropertyNames(StwrdSessionObject.prototype).filter((name) => name !== "constructor" && name !== "alarm");

  it.each(names)("%s is not an async function", (name) => {
    const method = (StwrdSessionObject.prototype as unknown as Record<string, unknown>)[name];
    expect(typeof method).toBe("function");
    expect((method as () => unknown).constructor.name).toBe("Function");
  });

  // `async` is not the only way to hand back a promise: a plain function that
  // returns one (`return somethingAsync()`) lets another call in just the same.
  // So each method is also called, and what it returns looked at.
  const CALLS: Record<string, unknown[]> = {
    get: [],
    set: ["envelope", inOneHour()],
    delete: [],
    retire: [],
    claim: ["owner", 30],
    markSent: [1],
    checkpoint: [1, "envelope", false],
    complete: [1, "envelope", inOneHour()],
    release: [1, true],
    logout: ["jti-sync", inOneHour()],
  };
  const HELPERS = ["hasSchema", "ensureSchema", "rows", "nowS", "nextFence", "scheduleAlarm"];

  it("every method is either called below or a known private helper (a new one has to be added to one)", () => {
    expect([...names].sort()).toEqual([...Object.keys(CALLS), ...HELPERS].sort());
  });

  it.each(Object.keys(CALLS))("%s returns a plain value, not a promise", async (name) => {
    const stub = await withSession();
    const returnsPromise = await runInDurableObject(stub, (instance: StwrdSessionObject) => {
      const result = (instance as unknown as Record<string, (...args: unknown[]) => unknown>)[name](...CALLS[name]);
      return typeof (result as { then?: unknown } | null | undefined)?.then === "function";
    });
    expect(returnsPromise).toBe(false);
  });
});

