import { expect, it, vi } from "vitest";
import { ManagementTransport } from "@stwrd-auth/core/managementTransport";
const issuer = "https://login.account.test";
const discovery = { issuer, token_endpoint: issuer + "/oidc/token", management_api_base_url: "https://account.test/api/v1", management_api_audience: "https://account.test" };
function reply(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
it("honors the initial cursor supplied by a caller resuming traversal", async () => {
  const resources: URL[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async url => {
    if (String(url).endsWith("openid-configuration")) return reply(discovery);
    if (String(url).endsWith("token")) return reply({ access_token: "token", token_type: "Bearer", expires_in: 60 });
    resources.push(new URL(String(url)));
    return reply({ items: [{ id: "resumed" }], page: { next_cursor: null } });
  });
  const transport = new ManagementTransport({ issuer, clientId: "service", clientSecret: "secret", fetch });
  const result = [];
  for await (const item of transport.iterate("/users", { cursor: "resume-observation", email: "same-filter" })) result.push(item);
  expect(result).toEqual([{ id: "resumed" }]);
  expect(resources[0]?.searchParams.get("cursor")).toBe("resume-observation");
  expect(resources[0]?.searchParams.get("email")).toBe("same-filter");
});
it("a late 401 from an old acquisition cannot discard a newer credential", async () => {
  let acquired = 0; let finish!: (response: Response) => void; let calls = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    if (String(url).endsWith("openid-configuration")) return reply(discovery);
    if (String(url).endsWith("token")) return reply({ access_token: `token-${++acquired}`, token_type: "Bearer", expires_in: 60 });
    calls++;
    if (calls === 1) return new Promise<Response>(resolve => { finish = resolve; });
    if (calls === 2) return reply({}, 401);
    return reply({ id: "ok" });
  });
  const transport = new ManagementTransport({ issuer, clientId: "service", clientSecret: "secret", fetch });
  const old = transport.request("GET", "/users/old").catch(() => {});
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await transport.request("GET", "/users/rejected").catch(() => {});
  await transport.request("GET", "/users/fresh");
  finish(reply({}, 401)); await old;
  await transport.request("GET", "/users/still-fresh");
  expect(acquired).toBe(2);
});
it("preserves multipart identity and binary evidence without inventing JSON content headers", async () => {
  let input: RequestInit | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (String(url).endsWith("openid-configuration")) return reply(discovery);
    if (String(url).endsWith("token")) return reply({ access_token: "token", token_type: "Bearer", expires_in: 60 });
    input = init;
    return new Response(new Uint8Array([0, 255, 10]), { headers: { ETag: '"evidence"' } });
  });
  const transport = new ManagementTransport({ issuer, clientId: "service", clientSecret: "secret", fetch });
  const body = new FormData(); body.append("document", new Blob(["legal"]), "legal.pdf");
  const result = await transport.request<Uint8Array>("POST", "/consents/one/versions", body, { responseType: "bytes", ifMatch: '"observed"', idempotencyKey: "intent" });
  expect(input?.body).toBe(body);
  expect(new Headers(input?.headers).has("Content-Type")).toBe(false);
  expect([...result.data]).toEqual([0, 255, 10]);
  expect(result.etag).toBe('"evidence"');
});
it("rejects a redirect reported by a custom fetch and always requests redirect denial", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    expect(init?.redirect).toBe("manual");
    const response = reply(discovery);
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  });
  const transport = new ManagementTransport({ issuer, clientId: "service", clientSecret: "secret", fetch });
  await expect(transport.request("GET", "/users")).rejects.toThrow(/redirects/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves token endpoint HTTP status and request ID when an upstream error is not JSON", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async url => {
    if (String(url).endsWith("openid-configuration")) return reply(discovery);
    return new Response("upstream temporarily unavailable", { status: 503, headers: { "Content-Type": "text/plain", "X-Request-ID": "token-unavailable" } });
  });
  const transport = new ManagementTransport({ issuer, clientId: "service", clientSecret: "secret", fetch });
  await expect(transport.request("GET", "/users")).rejects.toMatchObject({ status: 503, requestId: "token-unavailable" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
