// Back-channel logout through the session's own Durable Object.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { Keyring } from "@stwrd-auth/core/keyring";
import { IdpUnavailable } from "@stwrd-auth/core/oidc";
import type { StwrdSession } from "@stwrd-auth/core/sessions";
import { DurableObjectSessionStore, SESSION_OBJECT_PREFIX, type SessionObjects, UNNAMED_NOTICE_OBJECT } from "../../src/store.js";

const KEYRING = new Keyring({ k: new Uint8Array(32).fill(7) }, "k");
const NAMESPACE = `ns-${crypto.randomUUID()}`;
const store = (namespace = NAMESPACE) => new DurableObjectSessionStore(env.STWRD_SESSIONS, { namespace, keyring: KEYRING });
const sink = (namespace = NAMESPACE) => store(namespace).backChannelSink();
const inOneHour = () => Date.now() / 1000 + 3600;
const live = (id: string): StwrdSession => ({
  id,
  sidIdp: "sid",
  sub: "usr_1",
  claims: { sub: "usr_1" },
  tokens: { access_token: "a", id_token: "i", token_type: "Bearer", expiresAt: inOneHour() },
  expiresAt: inOneHour(),
  accessExpiresAt: inOneHour(),
});

describe("the store's back-channel sink", () => {
  it("ends the session the notice names and refuses its replay", async () => {
    const sessions = store();
    const id = `s-${crypto.randomUUID()}`;
    await sessions.set(live(id));
    expect(await sink().terminate(id, "jti-1", inOneHour())).toBe("terminated");
    expect(await sessions.get(id)).toBeNull();
    expect(await sink().terminate(id, "jti-1", inOneHour())).toBe("replay");
  });

  it("a replay deletes nothing: a session signed in again after the notice survives it", async () => {
    const sessions = store();
    const id = `s-${crypto.randomUUID()}`;
    await sink().terminate(id, "jti-2", inOneHour());
    await sessions.set(live(id));
    expect(await sink().terminate(id, "jti-2", inOneHour())).toBe("replay");
    expect(await sessions.get(id)).not.toBeNull();
  });

  it("does not touch another session", async () => {
    const sessions = store();
    const [one, two] = [`s-${crypto.randomUUID()}`, `s-${crypto.randomUUID()}`];
    await sessions.set(live(one));
    await sessions.set(live(two));
    await sink().terminate(one, "jti-3", inOneHour());
    expect(await sessions.get(two)).not.toBeNull();
  });

  it("a notice for one namespace does not end the session of another that has the same id", async () => {
    const [mine, theirs] = [store(`${NAMESPACE}-mine`), store(`${NAMESPACE}-theirs`)];
    const id = `s-${crypto.randomUUID()}`;
    await mine.set(live(id));
    await theirs.set(live(id));
    expect(await sink(`${NAMESPACE}-mine`).terminate(id, "jti-5", inOneHour())).toBe("terminated");
    expect(await mine.get(id)).toBeNull();
    expect(await theirs.get(id)).not.toBeNull();
    // and the jti it marked is its own: the other namespace still sees it as new
    expect(await sink(`${NAMESPACE}-theirs`).terminate(id, "jti-5", inOneHour())).toBe("terminated");
    expect(await theirs.get(id)).toBeNull();
  });

  it("remembers the jti of a notice that names no sid", async () => {
    const unique = `jti-${crypto.randomUUID()}`;
    expect(await sink().terminate(null, unique, inOneHour())).toBe("terminated");
    expect(await sink().terminate(null, unique, inOneHour())).toBe("replay");
    expect(UNNAMED_NOTICE_OBJECT.startsWith(SESSION_OBJECT_PREFIX)).toBe(false);
  });

  it("raises IdpUnavailable when the object does not answer, and marks nothing", async () => {
    const down = new Proxy(env.STWRD_SESSIONS, {
      get: (target, property) =>
        property === "get"
          ? () => new Proxy({}, { get: () => () => Promise.reject(new Error("Durable Object reset")) })
          : Reflect.get(target, property).bind(target),
    }) as SessionObjects;
    await expect(new DurableObjectSessionStore(down, { namespace: NAMESPACE, keyring: KEYRING }).backChannelSink().terminate("s", "jti-4", inOneHour())).rejects.toBeInstanceOf(IdpUnavailable);
    expect(await sink().terminate("s", "jti-4", inOneHour())).toBe("terminated"); // the retry still ends it
  });
});
