import { expect, it, vi } from "vitest";
import { ManagementTransport } from "@stwrd-auth/core/managementTransport";

const issuer = "https://login.test";
const metadata = (account: string) => ({ issuer, token_endpoint: issuer + "/oidc/token", management_api_base_url: account + "/api/v1", management_api_audience: account });
const reply = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers });
const token = (value: string) => reply({ access_token: value, token_type: "Bearer", expires_in: 3600 });

it.each([
  ["max-age=3600", 60000], [undefined, 30000], ["no-store, max-age=3600", 0],
  ["max-age=3600, no-cache", 0], ["max-age=1", 1000],
])("discovery TTL %s revalidates at its bounded deadline", async (control, ttl) => {
  let time = 1000; let reads = 0; let writes = 0; let healthy = true;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
  const fetch = vi.fn<typeof globalThis.fetch>(async url => {
    if (String(url).endsWith("openid-configuration")) {
      reads++;
      return healthy ? reply(metadata("https://account.test"), control === undefined ? {} : { "Cache-Control": control }) : new Response("unavailable", { status: 503 });
    }
    if (String(url).endsWith("token")) return token("still-valid");
    writes++; return reply({ id: "one" });
  });
  try {
    const api = new ManagementTransport({ issuer, clientId: "service", clientSecret: "secret", fetch });
    await api.request("PATCH", "/users/one", {});
    if (ttl > 0) {
      time += ttl - 1;
      await api.request("PATCH", "/users/one", {});
      expect(reads).toBe(1);
      time++;
    }
    healthy = false;
    const before = writes;
    await expect(api.request("PATCH", "/users/one", {})).rejects.toMatchObject({ status: 503 });
    await expect(api.request("PATCH", "/users/one", {})).rejects.toMatchObject({ status: 503 });
    expect(writes).toBe(before);
    healthy = true;
    await api.request("PATCH", "/users/one", {});
    expect(writes).toBe(before + 1);
    expect(reads).toBe(4);
  } finally { clock.mockRestore(); }
});

it("old binding completion cannot clear a newer token acquisition owner", async () => {
  let time = 1000; let account = "https://first.test";
  let releaseA!: (response: Response) => void; let releaseB!: (response: Response) => void;
  let announceA!: () => void; let announceB!: () => void;
  const enteredA = new Promise<void>(resolve => { announceA = resolve; });
  const enteredB = new Promise<void>(resolve => { announceB = resolve; });
  let tokens = 0; const writes: Array<[string, string | null]> = [];
  const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (String(url).endsWith("openid-configuration")) return reply(metadata(account), { "Cache-Control": "max-age=1" });
    if (String(url).endsWith("token")) {
      tokens++;
      return new Promise<Response>(resolve => {
        if (tokens === 1) { releaseA = resolve; announceA(); }
        else if (tokens === 2) { releaseB = resolve; announceB(); }
        else resolve(token("unexpected-extra"));
      });
    }
    writes.push([String(url), new Headers(init?.headers).get("Authorization")]);
    return reply({ id: "one" });
  });
  try {
    const api = new ManagementTransport({ issuer, clientId: "service", clientSecret: "secret", fetch });
    const first = api.request("PATCH", "/users/one", {}); await enteredA;
    time += 2000; account = "https://second.test";
    const second = api.request("PATCH", "/users/one", {}); await enteredB;
    releaseA(token("first-binding")); await first;
    const followers = Array.from({ length: 8 }, () => api.request("PATCH", "/users/one", {}));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(tokens).toBe(2);
    releaseB(token("second-binding")); await Promise.all([second, ...followers]);
    expect(writes[0]).toEqual(["https://first.test/api/v1/users/one", "Bearer first-binding"]);
    expect(writes.slice(1)).toHaveLength(9);
    expect(writes.slice(1).every(([url, auth]) => url.startsWith("https://second.test/") && auth === "Bearer second-binding")).toBe(true);
  } finally { clock.mockRestore(); }
});
