// A bearer token or a service secret must never follow a redirect, and the
// refusal has to work on workerd as well: there `fetch(..., { redirect: "error" })`
// throws on EVERY call (only "follow" and "manual" exist), so a transport that
// asks for "error" cannot talk to the IdP at all. The code asks for "manual"
// and rejects any 3xx itself. The IdP here is a loopback server that
// redirects; `viaLoopback` sends `https://<scenario>.test/x` to it with the
// runtime's own `fetch` (so the redirect mode is the real one).
import { inject, describe, expect, it } from "vitest";

import { IdpUnavailable, OidcClient, OidcError, type Discovery } from "../../src/oidc.js";
import { ManagementTransport } from "../../src/managementTransport.js";
import { listOwnOrganizations } from "../../src/organizations.js";

const port = () => inject("ports").redirecting;

const viaLoopback = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input));
  const scenario = url.hostname.replace(/\.test$/, "");
  return fetch(`http://127.0.0.1:${port()}/${scenario}${url.pathname}${url.search}`, init);
};

const leaksFor = async (scenario: string) => {
  const all = (await (await fetch(`http://127.0.0.1:${port()}/__leaks`)).json()) as Array<{ path: string }>;
  return all.filter((leak) => leak.path.startsWith(`/${scenario}/`));
};

const transport = (scenario: string, fetchImpl: typeof globalThis.fetch = viaLoopback as typeof globalThis.fetch) =>
  new ManagementTransport({ issuer: `https://${scenario}.test`, clientId: "service", clientSecret: "private-secret", fetch: fetchImpl });

const discoveryFor = (scenario: string): Discovery => {
  const origin = `https://${scenario}.test`;
  return {
    document: {
      issuer: origin,
      token_endpoint: `${origin}/oidc/token`,
      management_api_base_url: `${origin}/api/v1`,
      management_api_audience: origin,
    },
  } as unknown as Discovery;
};

describe("Management transport", () => {
  it("talks to an IdP that does not redirect", async () => {
    const result = await transport("ok").request<{ ok: boolean }>("GET", "/things");
    expect(result.data).toEqual({ ok: true });
  });

  it.each(["moved-discovery", "moved-token", "moved-resource"])("refuses a redirect (%s) and never follows it", async (scenario) => {
    await expect(transport(scenario).request("GET", "/things")).rejects.toThrow("Management redirects are forbidden");
    expect(await leaksFor(scenario)).toEqual([]);
  });

  it.each([
    ["a followed redirect (redirected: true)", () => Object.defineProperty(Response.json({}), "redirected", { value: true })],
    ["an opaque redirect (type opaqueredirect)", () => Object.defineProperty(new Response(null, { status: 200 }), "type", { value: "opaqueredirect" })],
  ])("refuses %s reported by the runtime", async (_label, response) => {
    const fetchImpl = (async () => response()) as typeof globalThis.fetch;
    await expect(transport("ok", fetchImpl).request("GET", "/things")).rejects.toThrow("Management redirects are forbidden");
  });
});

describe("own organizations", () => {
  it("lists them through an IdP that does not redirect", async () => {
    const organizations = await listOwnOrganizations(viaLoopback, "https://ok.test", discoveryFor("ok"), "user-token");
    expect(organizations).toEqual([{ id: "11111111-2222-3333-4444-555555555555", displayName: "Acme" }]);
  });

  it("refuses a redirect and the bearer token never reaches its target", async () => {
    await expect(
      listOwnOrganizations(viaLoopback, "https://moved-resource.test", discoveryFor("moved-resource"), "user-token"),
    ).rejects.toBeInstanceOf(IdpUnavailable);
    expect(await leaksFor("moved-resource")).toEqual([]);
  });

  it.each([
    ["a followed redirect (redirected: true)", () => Object.defineProperty(Response.json({ items: [], page: { next_cursor: null } }), "redirected", { value: true })],
    ["an opaque redirect (type opaqueredirect)", () => Object.defineProperty(Response.json({ items: [], page: { next_cursor: null } }), "type", { value: "opaqueredirect" })],
  ])("refuses %s reported by the runtime", async (_label, response) => {
    await expect(
      listOwnOrganizations(async () => response(), "https://ok.test", discoveryFor("ok"), "user-token"),
    ).rejects.toThrow(/redirect/i);
  });
});

// With `redirect: "manual"` a 3xx arrives with its body, and the connection
// stays held until the body is read or cancelled: the refusal must release it.
describe("a refused redirect releases its connection", () => {
  const redirecting = () => {
    const state = { cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { state, response: new Response(body, { status: 302, headers: { location: "https://elsewhere.test/leak" } }) };
  };

  it("in the Management transport", async () => {
    const { state, response } = redirecting();
    const fetchImpl = (async () => response) as typeof globalThis.fetch;
    await expect(transport("ok", fetchImpl).request("GET", "/things")).rejects.toThrow("Management redirects are forbidden");
    expect(state.cancelled).toBe(true);
  });

  it("in the own-organizations list", async () => {
    const { state, response } = redirecting();
    await expect(
      listOwnOrganizations(async () => response, "https://ok.test", discoveryFor("ok"), "user-token"),
    ).rejects.toBeInstanceOf(IdpUnavailable);
    expect(state.cancelled).toBe(true);
  });
});

// The OIDC client talks to the IdP with the client secret, a refresh token and
// the PKCE verifier in the body of a POST: a 307/308 would re-send all of it to
// the other origin. None of the five calls follows a redirect, and each one
// fails the way any answer that is not a 200 does (an `OidcError`, which for a
// refresh ends the session, as in the Python SDK).
describe("the OIDC client never follows a redirect", () => {
  const client = (scenario: string, fetchImpl: typeof globalThis.fetch = viaLoopback as typeof globalThis.fetch) =>
    new OidcClient(fetchImpl, {
      issuer: `https://${scenario}.test`,
      clientId: "client",
      clientSecret: "private-secret",
      redirectUri: "https://app.example/auth/callback",
      scope: "openid",
    });

  const calls: Array<[string, string, (oidc: OidcClient) => Promise<unknown>]> = [
    ["discovery", "discovery", (oidc) => oidc.discover()],
    ["jwks", "the JWKS", (oidc) => oidc._fetchJwks()],
    ["token", "the code exchange", (oidc) => oidc.exchangeCode({ code: "c", codeVerifier: "v" })],
    ["token", "the refresh", (oidc) => oidc.exchangeRefreshToken("refresh-secret")],
    ["userinfo", "userinfo", (oidc) => oidc.userinfo("access-token")],
  ];

  it.each(calls.flatMap(([call, label, run]) => [301, 302, 303, 307, 308].map((status) => [status, call, label, run] as const)))(
    "a %i on %s (%s) is refused and nothing reaches the other origin",
    async (status, call, _label, run) => {
      const scenario = `r${status}-${call}`;
      await expect(run(client(scenario))).rejects.toBeInstanceOf(OidcError);
      expect(await leaksFor(scenario)).toEqual([]);
    },
  );

  it("still talks to an IdP that does not redirect", async () => {
    const oidc = client("r302-none");
    expect((await oidc.discover()).issuer).toBe("https://r302-none.test");
    expect(await oidc.userinfo("access-token")).toEqual({ sub: "u" });
    expect(await oidc.exchangeRefreshToken("refresh-secret")).toMatchObject({ token_type: "Bearer" });
  });

  it("asks for manual redirects, and releases the body of the refusal", async () => {
    let cancelled = false;
    const seen: Array<RequestInit | undefined> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push(init);
      const body = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array([1])), cancel: () => { cancelled = true; } });
      return new Response(body, { status: 307, headers: { location: "https://elsewhere.test/leak" } });
    }) as unknown as typeof globalThis.fetch;
    await expect(client("ok", fetchImpl).discover()).rejects.toBeInstanceOf(OidcError);
    expect(seen[0]?.redirect).toBe("manual");
    expect(cancelled).toBe(true);
  });

  it.each([
    ["a followed redirect (redirected: true)", () => Object.defineProperty(Response.json({}), "redirected", { value: true })],
    ["an opaque redirect (type opaqueredirect)", () => Object.defineProperty(new Response(null, { status: 200 }), "type", { value: "opaqueredirect" })],
  ])("refuses %s reported by the runtime", async (_label, response) => {
    const fetchImpl = (async () => response()) as unknown as typeof globalThis.fetch;
    await expect(client("ok", fetchImpl).exchangeRefreshToken("refresh-secret")).rejects.toBeInstanceOf(OidcError);
  });
});
