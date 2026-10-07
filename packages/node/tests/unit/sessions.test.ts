/**
 * `StwrdUser`, `StwrdSession`, `MemoryStore`. In `GET /auth/session` the keys
 * of `user` are always present, with `null` / `[]` when there is no data.
 */

import { describe, expect, it } from "vitest";

import {
  MemoryStore,
  type StwrdSession,
  type Tokens,
  accessExpiry,
  hasPermission,
  hasRole,
  isAccessTokenExpired,
  isSessionExpired,
  userFromClaims,
  contextFromClaims,
} from "@stwrd-auth/core/sessions";

describe("userFromClaims", () => {
  it("fills absent optional fields with null or an empty list", () => {
    const user = userFromClaims({ sub: "usr_1" });
    expect(user.email).toBeNull();
    expect(user.email_verified).toBe(false);
    expect(user.roles).toEqual([]);
    expect(user.permissions).toEqual([]);
    expect(contextFromClaims({ sub: "usr_1" }).consents).toEqual({});
  });

  it("reads consents from the userinfo claim", () => {
    // Consents report state ("accepted", "declined"), never versions.
    const user = contextFromClaims({
      sub: "usr_1",
      consents: { terms: "accepted", marketing: "declined" },
    });
    expect(user.consents).toEqual({ terms: "accepted", marketing: "declined" });
  });

  it("avatar is the renamed picture claim", () => {
    // `avatar` is the OIDC `picture` claim, renamed.
    const user = userFromClaims({ sub: "usr_1", picture: "https://example.test/a.png" });
    expect(user.avatar_url).toBe("https://example.test/a.png");
  });

  it.each([
    [["org:admin"], "org:admin", true],
    [["org:member"], "org:admin", false],
    [[], "org:admin", false],
  ] as const)("hasRole is membership, not equality: %j has %s -> %s", (roles, role, expected) => {
    // An open registry is compared by membership, never by set equality.
    const user = contextFromClaims({ sub: "usr_1", org_id: "o", org_display_name: "Team", org_roles: roles, org_permissions: [] });
    expect(hasRole(user, role)).toBe(expected);
  });

  it("hasPermission is membership", () => {
    const user = contextFromClaims({ sub: "usr_1", org_id: "o", org_display_name: "Team", org_roles: [], org_permissions: ["members:invite"] });
    expect(hasPermission(user, "members:invite")).toBe(true);
    expect(hasPermission(user, "members:remove")).toBe(false);
  });
});

function tokens(options: { expiresInS?: number; refreshToken?: string } = {}): Tokens {
  const now = Date.now() / 1000;
  return {
    access_token: "at",
    id_token: "idt",
    token_type: "Bearer",
    expiresAt: now + (options.expiresInS ?? 3600),
    refresh_token: options.refreshToken,
  };
}

describe("accessExpiry", () => {
  it("computes epoch seconds from expires_in, defaulting to 3600", () => {
    const now = 1_700_000_000;
    expect(accessExpiry({ expires_in: 120 }, now)).toBe(now + 120);
    expect(accessExpiry({}, now)).toBe(now + 3600);
  });
});

describe("StwrdSession", () => {
  it("sessionUser derives from claims", () => {
    const session: StwrdSession = {
      id: "s1",
      sidIdp: "sid1",
      sub: "usr_1",
      claims: { sub: "usr_1", email: "a@b.test" },
      tokens: tokens(),
      expiresAt: Date.now() / 1000 + 3600,
      accessExpiresAt: Date.now() / 1000 + 3600,
    };
    expect(userFromClaims(session.claims).email).toBe("a@b.test");
  });

  it("access-token expiry is independent of the session ttl", () => {
    // The two clocks are separate on purpose: a session well inside its 8h
    // window can still have an access token that already expired.
    const now = Date.now() / 1000;
    const session: StwrdSession = {
      id: "s1",
      sidIdp: "sid1",
      sub: "usr_1",
      claims: { sub: "usr_1" },
      tokens: tokens({ expiresInS: -1 }),
      expiresAt: now + 3600,
      accessExpiresAt: now - 1,
    };
    expect(isAccessTokenExpired(session)).toBe(true);
    expect(isSessionExpired(session)).toBe(false);
  });
});

describe("MemoryStore", () => {
  it("round-trips a session", async () => {
    const store = new MemoryStore();
    const now = Date.now() / 1000;
    const session: StwrdSession = {
      id: "s1",
      sidIdp: "sid1",
      sub: "usr_1",
      claims: { sub: "usr_1" },
      tokens: tokens(),
      expiresAt: now + 3600,
      accessExpiresAt: now + 3600,
    };
    await store.set(session);
    expect(await store.get("s1")).toBe(session);
    await store.delete("s1");
    expect(await store.get("s1")).toBeNull();
  });

  const staleSession = (id = "s1"): StwrdSession => {
    const now = Date.now() / 1000;
    return { id, sidIdp: "sid1", sub: "usr_1", claims: { sub: "usr_1", org_id: "o", name: "old" }, tokens: tokens(), expiresAt: now + 3600, accessExpiresAt: now - 1 };
  };

  it("refresh lease is exclusive and fenced", async () => {
    const store = new MemoryStore();
    await store.set(staleSession());
    const first = await store.claimRefresh("s1", "a", 30);
    if (first.status !== "granted") throw new Error("expected a grant");
    expect(first.phase).toBe("acquired");
    expect((await store.claimRefresh("s1", "b", 30)).status).toBe("busy");
    expect(await store.markRefreshSent("s1", first.fence + 1)).toBe(false);
    expect(await store.markRefreshSent("s1", first.fence)).toBe(true);
    expect(await store.markRefreshSent("s1", first.fence)).toBe(false);
    const rotated = tokens({ expiresInS: 7200 });
    expect(await store.checkpointRefresh("s1", first.fence, rotated, true)).toBe(true);
    const checkpointed = await store.get("s1");
    expect(checkpointed?.tokens).toBe(rotated);
    expect(checkpointed?.claims.org_id).toBeUndefined(); // authority is stale until userinfo
    expect(isAccessTokenExpired(checkpointed as StwrdSession)).toBe(true);
    const renewed = { ...(checkpointed as StwrdSession), claims: { sub: "usr_1", name: "new" } };
    expect(await store.completeRefresh("s1", first.fence, renewed)).toBe(true);
    expect(await store.completeRefresh("s1", first.fence, renewed)).toBe(false);
    expect((await store.claimRefresh("s1", "b", 30)).status).toBe("granted");
  });

  it("an expired lease is judged by its phase", async () => {
    const store = new MemoryStore();
    await store.set(staleSession());
    await store.claimRefresh("s1", "a", 0);
    const again = await store.claimRefresh("s1", "b", 0); // owner died before sending
    if (again.status !== "granted") throw new Error("expected a grant");
    expect(await store.markRefreshSent("s1", again.fence)).toBe(true);
    expect((await store.claimRefresh("s1", "c", 30)).status).toBe("uncertain");
    expect((await store.claimRefresh("s1", "d", 30)).status).toBe("uncertain"); // permanent

    await store.set(staleSession("s2"));
    const lease = await store.claimRefresh("s2", "a", 0);
    if (lease.status !== "granted") throw new Error("expected a grant");
    await store.markRefreshSent("s2", lease.fence);
    await store.checkpointRefresh("s2", lease.fence, tokens(), false);
    const resumed = await store.claimRefresh("s2", "b", 30); // owner died while hydrating
    expect(resumed.status === "granted" && resumed.phase).toBe("hydrating");
  });

  it("delete defeats every in-flight write", async () => {
    const store = new MemoryStore();
    await store.set(staleSession());
    const lease = await store.claimRefresh("s1", "a", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    await store.markRefreshSent("s1", lease.fence);
    await store.delete("s1");
    expect(await store.checkpointRefresh("s1", lease.fence, tokens(), false)).toBe(false);
    expect(await store.completeRefresh("s1", lease.fence, staleSession())).toBe(false);
    expect(await store.get("s1")).toBeNull();
    expect((await store.claimRefresh("s1", "b", 30)).status).toBe("gone");
  });

  it("release distinguishes unsent from possibly processed", async () => {
    const store = new MemoryStore();
    await store.set(staleSession());
    const lease = await store.claimRefresh("s1", "a", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    await store.markRefreshSent("s1", lease.fence);
    await store.releaseRefresh("s1", lease.fence, false); // never left
    const retry = await store.claimRefresh("s1", "b", 30);
    if (retry.status !== "granted") throw new Error("expected a grant");
    expect(retry.phase).toBe("acquired");
    await store.markRefreshSent("s1", retry.fence);
    await store.releaseRefresh("s1", retry.fence, true); // may have been processed
    expect((await store.claimRefresh("s1", "c", 30)).status).toBe("uncertain");
  });

  it("replaceSession swaps only a live session and defeats its lease", async () => {
    const store = new MemoryStore();
    await store.set(staleSession("old"));
    const lease = await store.claimRefresh("old", "a", 30);
    if (lease.status !== "granted") throw new Error("expected a grant");
    expect(await store.replaceSession("old", staleSession("new"))).toBe(true);
    expect(await store.get("old")).toBeNull();
    expect(await store.get("new")).not.toBeNull();
    expect(await store.markRefreshSent("old", lease.fence)).toBe(false); // no resurrection
    expect(await store.replaceSession("old", staleSession("again"))).toBe(false);
    expect(await store.get("again")).toBeNull();
  });
});
