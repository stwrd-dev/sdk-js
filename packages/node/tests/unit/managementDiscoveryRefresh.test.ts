import { expect, it, vi } from "vitest";
import { ManagementTransport } from "@stwrd-auth/core/managementTransport";
const issuer = "https://login.test";
const metadata = (account: string) => ({issuer, token_endpoint: issuer + "/oidc/token", management_api_base_url: account + "/api/v1", management_api_audience: account});
const reply = (body: unknown, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), {headers});
it("refreshes account metadata and never sends the previous account credential to the new destination", async () => {
  let time = 1000; let account = "https://first.test"; let tokens = 0;
  const now = vi.spyOn(Date, "now").mockImplementation(() => time);
  const writes: Array<[string,string|null]> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (String(url).endsWith("openid-configuration")) return reply(metadata(account), {"Cache-Control":"max-age=1"});
    if (String(url).endsWith("token")) return reply({access_token: `token-${++tokens}`, token_type:"Bearer", expires_in:3600});
    writes.push([String(url), new Headers(init?.headers).get("Authorization")]);return reply({id:"one"});
  });
  try {
    const api = new ManagementTransport({issuer, clientId:"service", clientSecret:"secret", fetch});
    await api.request("PATCH", "/users/one", {});
    time += 2000; account = "https://second.test";
    await api.request("PATCH", "/users/one", {});
    expect(writes).toEqual([["https://first.test/api/v1/users/one","Bearer token-1"],["https://second.test/api/v1/users/one","Bearer token-2"]]);
    expect(tokens).toBe(2);
  } finally {now.mockRestore();}
});
it("metadata refresh failure stops writes despite a still valid cached token", async () => {
  let time=1000;let reads=0;let writes=0;
  const now=vi.spyOn(Date,"now").mockImplementation(()=>time);
  const fetch=vi.fn<typeof globalThis.fetch>(async url=>{
    if(String(url).endsWith("openid-configuration")) {if(++reads===2) return new Response("unavailable",{status:503});return reply(metadata("https://account.test"),{"Cache-Control":"max-age=1"});}
    if(String(url).endsWith("token")) return reply({access_token:"valid",token_type:"Bearer",expires_in:3600});
    writes++;return reply({id:"one"});
  });
  try {const api=new ManagementTransport({issuer,clientId:"service",clientSecret:"secret",fetch});await api.request("POST","/users",{});time+=2000;await expect(api.request("POST","/users",{})).rejects.toMatchObject({status:503});expect(writes).toBe(1);} finally {now.mockRestore();}
});
it("does not send a token that expired while acquisition was in flight",async()=>{
  let time=1000;let writes=0;const now=vi.spyOn(Date,"now").mockImplementation(()=>time);
  const fetch=vi.fn<typeof globalThis.fetch>(async url=>{
    if(String(url).endsWith("openid-configuration"))return reply(metadata("https://account.test"));
    if(String(url).endsWith("token")){time+=2000;return reply({access_token:"expired",token_type:"Bearer",expires_in:1});}
    writes++;return reply({id:"one"});
  });
  try{const api=new ManagementTransport({issuer,clientId:"service",clientSecret:"secret",fetch});await expect(api.request("POST","/users",{})).rejects.toThrow();expect(writes).toBe(0);}finally{now.mockRestore();}
});
