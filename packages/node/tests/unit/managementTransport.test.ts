import { describe, expect, it, vi } from "vitest";
import { ManagementError, ManagementTransport } from "@stwrd-auth/core/managementTransport";

const issuer = "https://login.account.test";
const base = "https://account.test/api/v1";
const discovery = { issuer, token_endpoint: issuer + "/oidc/token", management_api_base_url: base, management_api_audience: "https://account.test" };
const token = { access_token: "registered-credential", token_type: "Bearer", expires_in: 60 };
function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function options(fetch: typeof globalThis.fetch) {
  return { issuer, clientId: "service", clientSecret: "private-secret", fetch };
}
describe("registered management destination", () => {
  it.each([
    { ...discovery, issuer: "https://foreign.test" },
    { ...discovery, token_endpoint: "https://foreign.test/token" },
    { ...discovery, management_api_base_url: "http://account.test/api/v1" },
    { ...discovery, management_api_audience: "https://other.test" },
  ])("rejects untrusted discovery before sending credentials", async body => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(reply(body));
    await expect(new ManagementTransport(options(fetch)).request("GET", "/users")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.redirect).toBe("manual");
    expect(fetch.mock.calls[0][1]?.headers).toBeUndefined();
  });
  it("coalesces acquisition while binding headers and writes to the registered destination", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("openid-configuration")) return reply(discovery);
      if (String(url).endsWith("token")) return reply(token);
      return reply({ id: "one" }, 200, { ETag: '"v1"', "X-Request-ID": "request-one" });
    });
    const api = new ManagementTransport(options(fetch));
    const results = await Promise.all(Array.from({ length: 8 }, () => api.request("PATCH", "/users/one", { name: "One" }, { ifMatch: '"v0"', idempotencyKey: "intent", confirmationToken: "confirmed" })));
    expect(calls.filter(call => call.url.endsWith("token"))).toHaveLength(1);
    expect(calls.filter(call => call.url.endsWith("openid-configuration"))).toHaveLength(1);
    expect(results[0]).toEqual({ data: { id: "one" }, etag: '"v1"', requestId: "request-one" });
    const write = calls.find(call => call.url === base + "/users/one")!;
    const headers = new Headers(write.init!.headers);
    expect(headers.get("Authorization")).toBe("Bearer registered-credential");
    expect(headers.get("If-Match")).toBe('"v0"');
    expect(headers.get("Idempotency-Key")).toBe("intent");
    expect(headers.get("Confirmation-Token")).toBe("confirmed");
    expect(calls.every(call => call.init?.redirect === "manual")).toBe(true);
  });
  it("never retries a rejected write and discards its rejected credential", async () => {
    let acquisitions = 0; let writes = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async url => {
      if (String(url).endsWith("openid-configuration")) return reply(discovery);
      if (String(url).endsWith("token")) { acquisitions++; return reply(token); }
      writes++; return reply({ error: { code: "invalid_admin_credential" } }, 401);
    });
    const api = new ManagementTransport(options(fetch));
    await expect(api.request("POST", "/users", {})).rejects.toBeInstanceOf(ManagementError);
    expect(writes).toBe(1);
    await expect(api.request("POST", "/users", {})).rejects.toBeInstanceOf(ManagementError);
    expect(acquisitions).toBe(2); expect(writes).toBe(2);
  });
  it.each(["/../internal/v1/operators", "/%2e%2e/internal/v1/operators", "/users?other=true", "/users\\..\\other"])("rejects resource escape %s before acquisition", async path => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(new ManagementTransport(options(fetch)).request("GET", path)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["cursor", "duplicate"])("stops a repeated %s in pagination", async failure => {
    let page = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async url => {
      if (String(url).endsWith("openid-configuration")) return reply(discovery);
      if (String(url).endsWith("token")) return reply(token);
      page++;
      return reply({ items: [{ id: failure === "duplicate" ? "same" : String(page) }], page: { next_cursor: "same-cursor" } });
    });
    const api = new ManagementTransport(options(fetch));
    await expect((async () => { for await (const item of api.iterate("/users")) void item; })()).rejects.toThrow(/Repeated/);
    expect(page).toBe(2);
  });
});
