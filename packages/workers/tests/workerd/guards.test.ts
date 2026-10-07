// The Worker guards on their own terms: one resolution per request, what each
// denial looks like, and `protect`'s public list. (What a guard decides is also
// run through the shared contract in `authContract.test.ts`.)
import { describe, expect, it } from "vitest";

import { ConfigError } from "@stwrd-auth/core/config";
import { MemoryStore, type StwrdSession } from "@stwrd-auth/core/sessions";
import { stwrdFor } from "../../src/stwrd.js";

const variables = {
  STWRD_ISSUER: "https://idp.fake.test",
  STWRD_CLIENT_ID: "client-1",
  STWRD_CLIENT_SECRET: "shh",
  STWRD_BASE_URL: "https://app.example",
  STWRD_COOKIE_SECRET: "k".repeat(32),
  STWRD_SCOPE: "openid profile email offline_access org",
};

const inOneHour = () => Date.now() / 1000 + 3600;
const session = (claims: Record<string, unknown> = {}): StwrdSession => ({
  id: "s1",
  sidIdp: "sid1",
  sub: "usr_1",
  claims: { sub: "usr_1", roles: [], permissions: [], ...claims },
  tokens: { access_token: "a", id_token: "i", token_type: "Bearer", expiresAt: inOneHour() },
  expiresAt: inOneHour(),
  accessExpiresAt: inOneHour(),
});

/** A Worker adapter over a store that counts reads, and a request that carries the session. */
async function setup(claims: Record<string, unknown> = {}, extraVariables: Record<string, string> = {}) {
  const store = new MemoryStore();
  let reads = 0;
  const counting = new Proxy(store, {
    get(target, property) {
      if (property === "get") return async (id: string) => (reads++, target.get(id));
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const stwrd = stwrdFor({ ...variables, ...extraVariables }, { sessions: counting });
  await store.set(session(claims));
  const request = (path = "/private", headers: Record<string, string> = {}) =>
    new Request(`https://app.example${path}`, { headers: { cookie: `${stwrd.config.sessionCookie}=${stwrd.seal({ sid: "s1" })}`, ...headers } });
  return { stwrd, request, reads: () => reads };
}
const anonymous = (path = "/private", headers: Record<string, string> = {}) => new Request(`https://app.example${path}`, { headers });

describe("one resolution per request", () => {
  it("reads the session once however many guards ask", async () => {
    const { stwrd, request, reads } = await setup({ org_id: "o1", org_display_name: "Team", org_roles: ["org:admin"], org_permissions: ["p"], roles: undefined, permissions: undefined });
    const req = request();
    await stwrd.requireAuth(req);
    await stwrd.requireRole(req, "org:admin");
    await stwrd.requirePermission(req, "p");
    await stwrd.requireOrg(req);
    await stwrd.resolve(req);
    expect(reads()).toBe(1);
    await stwrd.requireAuth(request());
    expect(reads()).toBe(2); // another request object is another resolution
  });
});

describe("denials", () => {
  it("a navigation without a session goes to sign-in, coming back to the same path and query", async () => {
    const { stwrd } = await setup();
    const result = await stwrd.requireAuth(anonymous("/clients?page=2&q=a b", { accept: "text/html,application/xhtml+xml" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(303);
    expect(result.response.headers.get("location")).toBe("/auth/sign-in?return_to=%2Fclients%3Fpage%3D2%26q%3Da%2520b");
  });

  it("a non-navigation, or `api: true` even for a navigation, gets 401 JSON", async () => {
    const { stwrd } = await setup();
    for (const [headers, options] of [[{ accept: "application/json" }, {}], [{}, {}], [{ accept: "text/html" }, { api: true }]] as const) {
      const result = await stwrd.requireAuth(anonymous("/private", headers), options);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual({ detail: "No session." });
    }
  });

  it("a signed-in person without the role or the permission gets 403", async () => {
    const { stwrd, request } = await setup({ org_id: "o1", org_display_name: "Team", org_roles: ["org:member"], org_permissions: [], roles: undefined, permissions: undefined });
    for (const result of [await stwrd.requireRole(request(), "org:admin"), await stwrd.requirePermission(request(), "members:invite")]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  });

  it("the user of an allowed request is the `sub`, global and stable", async () => {
    const { stwrd, request } = await setup();
    const result = await stwrd.requireAuth(request());
    expect(result.ok && result.context.user?.id).toBe("usr_1");
    expect(result.ok && result.context.session?.sub).toBe("usr_1");
  });

  it("requireOrg needs the org scope in the configuration", async () => {
    const { stwrd, request } = await setup({}, { STWRD_SCOPE: "openid profile email" });
    await expect(stwrd.requireOrg(request())).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("protect", () => {
  it.each<[string, string, boolean]>([
    ["an exact public path", "/health", true],
    ["a path that only shares the start of an exact one", "/healthz", false],
    ["a prefix ending in *", "/public/info", true],
    ["a * in the middle is a character, not a wildcard", "/a*b/x", false],
    ["the auth prefix itself", "/auth/sign-in", true],
    ["everything under the auth prefix", "/auth/anything/else", true],
    ["a lookalike of the auth prefix", "/authx/secret", false],
    ["anything else", "/clients", false],
  ])("%s: %s", async (_label, path, isPublic) => {
    const { stwrd } = await setup();
    const denied = await stwrd.protect(anonymous(path, { accept: "application/json" }), { public: ["/health", "/public*", "/a*b"] });
    expect(denied === null).toBe(isPublic);
    if (denied) expect(denied.status).toBe(401);
  });

  it("lets a signed-in request through, and sends a navigation to sign-in", async () => {
    const { stwrd, request } = await setup();
    expect(await stwrd.protect(request("/clients"))).toBeNull();
    const denied = await stwrd.protect(anonymous("/clients", { accept: "text/html" }));
    expect(denied?.status).toBe(303);
  });
});
