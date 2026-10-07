/** PostgreSQL store: same lease contract as MemoryStore, encrypted at rest, safe
 * across real processes. Needs the test PostgreSQL (STWRD_TEST_DB_URL). */

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { Keyring, PostgresSessionStore, SCHEMA_SQL } from "../../src/postgres.js";
import type { StwrdSession, Tokens } from "@stwrd-auth/core/sessions";
import { coordinationScenarios } from "./coordinationScenarios.js";

const ADMIN_URL = (process.env.STWRD_TEST_DB_URL ?? "postgresql://stwrd:stwrd@localhost:55432/stwrd_test").replace("+psycopg", "");
const KEYS = { k1: new Uint8Array(32).fill(49), k2: new Uint8Array(32).fill(50) };
const name = `stwrd_sdk_pg_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
const url = ADMIN_URL.replace(/\/[^/]+$/, `/${name}`);
let pool: pg.Pool;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  pool = new pg.Pool({ connectionString: url, max: 8 });
  await pool.query(SCHEMA_SQL);
});
afterAll(async () => {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
});

const tokens = (expiresInS = 3600): Tokens => ({ access_token: "access-secret", id_token: "id-secret", token_type: "Bearer", refresh_token: "refresh-secret", expiresAt: Date.now() / 1000 + expiresInS });
const session = (id = "s1"): StwrdSession => ({ id, sidIdp: "sid1", sub: "usr_1", claims: { sub: "usr_1", org_id: "o", name: "old" }, tokens: tokens(), expiresAt: Date.now() / 1000 + 3600, accessExpiresAt: Date.now() / 1000 - 1 });
const fresh = (keyring = new Keyring(KEYS, "k1"), namespace = `tenant-${randomUUID()}/client`) => ({ namespace, keyring, store: new PostgresSessionStore(pool, { namespace, keyring }) });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("PostgresSessionStore", () => {
  it("round-trips and keeps tokens encrypted at rest", async () => {
    const { store, namespace } = fresh();
    const original = session();
    await store.set(original);
    expect(await store.get("s1")).toEqual(original);
    const { rows } = await pool.query("SELECT payload FROM stwrd_sdk_sessions WHERE namespace = $1", [namespace]);
    for (const secret of ["access-secret", "refresh-secret", "id-secret", "usr_1"]) expect(rows[0].payload).not.toContain(secret);
    expect(rows[0].payload.split(".")).toHaveLength(5);
    await store.delete("s1");
    expect(await store.get("s1")).toBeNull();
  });

  it("a row moved to another namespace or id is not a session", async () => {
    const { store, namespace, keyring } = fresh();
    await store.set(session("s1"));
    const other = new PostgresSessionStore(pool, { namespace: namespace + "-other", keyring });
    await pool.query("INSERT INTO stwrd_sdk_sessions (namespace, session_id, payload, expires_at) SELECT $1, 's1', payload, expires_at FROM stwrd_sdk_sessions WHERE namespace = $2 AND session_id = 's1'", [namespace + "-other", namespace]);
    await pool.query("INSERT INTO stwrd_sdk_sessions (namespace, session_id, payload, expires_at) SELECT namespace, 'renamed', payload, expires_at FROM stwrd_sdk_sessions WHERE namespace = $1 AND session_id = 's1'", [namespace]);
    expect(await other.get("s1")).toBeNull();
    expect(await store.get("renamed")).toBeNull();
    expect(await store.get("s1")).not.toBeNull();
    expect((await other.claimRefresh("s1", "x", 30)).status).toBe("gone");
  });

  it("rotates keys and rejects unknown ones", async () => {
    const { store, namespace } = fresh();
    await store.set(session());
    const rotated = new PostgresSessionStore(pool, { namespace, keyring: new Keyring(KEYS, "k2") });
    expect(await rotated.get("s1")).not.toBeNull();
    await rotated.set(session());
    const dropped = new PostgresSessionStore(pool, { namespace, keyring: new Keyring({ k2: KEYS.k2 }, "k2") });
    expect(await dropped.get("s1")).not.toBeNull();
    const wrong = new PostgresSessionStore(pool, { namespace, keyring: new Keyring({ k2: new Uint8Array(32).fill(57) }, "k2") });
    expect(await wrong.get("s1")).toBeNull();
    expect(() => new Keyring({ k: new Uint8Array(5) }, "k")).toThrow();
    expect(() => new Keyring(KEYS, "missing")).toThrow();
  });

  it("lease contract matches the memory store", async () => {
    const { store } = fresh();
    await store.set(session());
    const first = await store.claimRefresh("s1", "a", 30);
    if (first.status !== "granted") throw new Error("expected a grant");
    expect(first.phase).toBe("acquired");
    expect((await store.claimRefresh("s1", "b", 30)).status).toBe("busy");
    expect(await store.markRefreshSent("s1", first.fence + 1)).toBe(false);
    expect(await store.markRefreshSent("s1", first.fence)).toBe(true);
    expect(await store.markRefreshSent("s1", first.fence)).toBe(false);
    expect(await store.checkpointRefresh("s1", first.fence, tokens(7200), true)).toBe(true);
    const checkpointed = await store.get("s1");
    expect(checkpointed?.claims.org_id).toBeUndefined();
    expect(checkpointed!.accessExpiresAt).toBeLessThan(Date.now() / 1000);
    const renewed = { ...checkpointed!, claims: { sub: "usr_1", name: "new" } };
    expect(await store.completeRefresh("s1", first.fence, renewed)).toBe(true);
    expect(await store.completeRefresh("s1", first.fence, renewed)).toBe(false);
    expect((await store.claimRefresh("s1", "b", 30)).status).toBe("granted");
  });

  it("an expired lease is judged by phase, using the database clock", async () => {
    const { store } = fresh();
    await store.set(session());
    await store.claimRefresh("s1", "a", 0.05);
    await sleep(100);
    const again = await store.claimRefresh("s1", "b", 0.05);
    if (again.status !== "granted") throw new Error("expected a grant");
    expect(await store.markRefreshSent("s1", again.fence)).toBe(true);
    await sleep(100);
    expect((await store.claimRefresh("s1", "c", 30)).status).toBe("uncertain");
    expect((await store.claimRefresh("s1", "d", 30)).status).toBe("uncertain");

    await store.set(session("s2"));
    const lease = await store.claimRefresh("s2", "a", 0.05);
    if (lease.status !== "granted") throw new Error("expected a grant");
    await store.markRefreshSent("s2", lease.fence);
    await store.checkpointRefresh("s2", lease.fence, tokens(), false);
    await sleep(100);
    const resumed = await store.claimRefresh("s2", "b", 30);
    expect(resumed.status === "granted" && resumed.phase).toBe("hydrating");
  });

  it("delete defeats every in-flight write", async () => {
    const { store } = fresh();
    await store.set(session());
    const lease = await store.claimRefresh("s1", "a", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    await store.markRefreshSent("s1", lease.fence);
    await store.delete("s1");
    expect(await store.checkpointRefresh("s1", lease.fence, tokens(), false)).toBe(false);
    expect(await store.completeRefresh("s1", lease.fence, session())).toBe(false);
    expect(await store.get("s1")).toBeNull();
    expect((await store.claimRefresh("s1", "b", 30)).status).toBe("gone");
  });

  it("release distinguishes unsent from possibly processed", async () => {
    const { store } = fresh();
    await store.set(session());
    const lease = await store.claimRefresh("s1", "a", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    await store.markRefreshSent("s1", lease.fence);
    await store.releaseRefresh("s1", lease.fence, false);
    const retry = await store.claimRefresh("s1", "b", 30);
    if (retry.status !== "granted") throw new Error("expected a grant");
    expect(retry.phase).toBe("acquired");
    await store.markRefreshSent("s1", retry.fence);
    await store.releaseRefresh("s1", retry.fence, true);
    expect((await store.claimRefresh("s1", "c", 30)).status).toBe("uncertain");
  });

  it("replaceSession swaps only a live session atomically", async () => {
    const { store } = fresh();
    await store.set(session("old"));
    const lease = await store.claimRefresh("old", "a", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    expect(await store.replaceSession("old", session("new"))).toBe(true);
    expect(await store.get("old")).toBeNull();
    expect(await store.get("new")).not.toBeNull();
    expect(await store.markRefreshSent("old", lease.fence)).toBe(false);
    expect(await store.replaceSession("old", session("again"))).toBe(false);
    expect(await store.get("again")).toBeNull();
  });

  it("a reborn row never matches an old owner's fence", async () => {
    const { store } = fresh();
    await store.set(session());
    const old = await store.claimRefresh("s1", "a", 30);
    if (old.status !== "granted") throw new Error("expected a grant");
    await store.delete("s1");
    await store.set(session());
    const reborn = await store.claimRefresh("s1", "b", 30);
    if (reborn.status !== "granted") throw new Error("expected a grant");
    expect(reborn.fence).not.toBe(old.fence);
    expect(await store.markRefreshSent("s1", old.fence)).toBe(false);
  });

  it("purgeExpired removes only expired sessions", async () => {
    const { store } = fresh();
    await store.set(session("live"));
    await store.set({ ...session("dead"), expiresAt: Date.now() / 1000 - 5 });
    expect(await store.purgeExpired()).toBe(1);
    expect(await store.get("dead")).toBeNull();
    expect(await store.get("live")).not.toBeNull();
  });

  it("concurrent claims grant exactly one owner", async () => {
    const { store } = fresh();
    await store.set(session());
    const claims = await Promise.all(Array.from({ length: 8 }, (_, n) => store.claimRefresh("s1", `w${n}`, 30)));
    expect(claims.map(claim => claim.status).sort()).toEqual([...Array(7).fill("busy"), "granted"]);
  });

  it("two real processes refresh once", async () => {
    const { store, namespace } = fresh();
    await store.set(session());
    // Build core and this package (`tsc -b`) and run two independent Node
    // processes against the compiled `dist`: `jose`/`pg` and `@stwrd-auth/core`
    // resolve through the workspace's node_modules.
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const out = fileURLToPath(new URL("../../dist/", import.meta.url));
    const build = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("typescript/bin/tsc"), "-b", "tsconfig.json"], { cwd: root, encoding: "utf8" });
    expect(build.status, build.stdout + build.stderr).toBe(0);
    const script = `
      import pg from "pg";
      import { Keyring, PostgresSessionStore } from "${out}postgres.js";
      const [url, namespace, owner] = process.argv.slice(1);
      const pool = new pg.Pool({ connectionString: url, max: 2 });
      const store = new PostgresSessionStore(pool, { namespace, keyring: new Keyring({ k1: new Uint8Array(32).fill(49) }, "k1") });
      let outcome = "waited";
      for (;;) {
        const claim = await store.claimRefresh("s1", owner, 30);
        if (claim.status === "granted") {
          if (claim.session.accessExpiresAt > Date.now() / 1000) { await store.releaseRefresh("s1", claim.fence, false); break; }
          if (!(await store.markRefreshSent("s1", claim.fence))) throw new Error("lost");
          await new Promise(r => setTimeout(r, 500));
          if (!(await store.completeRefresh("s1", claim.fence, { ...claim.session, accessExpiresAt: Date.now() / 1000 + 3600 }))) throw new Error("lost");
          outcome = "exchanged";
          break;
        }
        const latest = await store.get("s1");
        if (latest.accessExpiresAt > Date.now() / 1000) break;
        await new Promise(r => setTimeout(r, 50));
      }
      console.log(JSON.stringify({ owner, outcome }));
      await pool.end();
    `;
    const run = (owner: string) => new Promise<{ outcome: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, url, namespace, owner], { cwd: new URL("../../", import.meta.url), stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", chunk => (out += chunk));
      child.on("exit", code => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exited ${code}`))));
    });
    const results = await Promise.all([run("proc-0"), run("proc-1")]);
    expect(results.map(result => result.outcome).sort()).toEqual(["exchanged", "waited"]);
  });
});

coordinationScenarios("postgres", () => fresh().store);
