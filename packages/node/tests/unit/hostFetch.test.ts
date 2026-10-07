/**
 * `makeHostFetch` (developing against a local identity provider): the
 * connection goes to `connectHost:connectPort`, the `Host` header goes out
 * as given, and the answer comes back as a real `Response`. A loopback
 * `node:http` server plays the identity provider.
 */

import { type AddressInfo, createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeHostFetch } from "../../src/index.js";

let server: Server;
let port: number;
let seen: { host?: string; url?: string; method?: string; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ host: req.headers.host, url: req.url, method: req.method, body: Buffer.concat(chunks).toString() });
      res.setHeader("content-type", "application/json");
      res.statusCode = 201;
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe("makeHostFetch", () => {
  it("connects to the given address and sends the issuer's Host verbatim", async () => {
    seen = [];
    const fetchLike = makeHostFetch({ connectHost: "127.0.0.1", connectPort: port, host: "myapp.example.com" });

    const response = await fetchLike("https://myapp.example.com/oidc/token?x=1", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token" }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      host: "myapp.example.com",
      url: "/oidc/token?x=1",
      method: "POST",
      body: "grant_type=refresh_token",
    });
  });
});
