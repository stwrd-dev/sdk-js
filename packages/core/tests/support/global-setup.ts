// Runs in plain Node, outside workerd. Provides to every test project:
//   * `vectors`: the reference values Node computes for `VECTOR_CASES`;
//   * `exportNames`: the exported names of each `src/*.ts` module, as Node sees them;
//   * `ports`: loopback servers and a port nobody listens on (network failures).
import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo, type Server } from "node:net";
import type { TestProject } from "vitest/node";

import { computeVectors } from "./vectorCases.js";

declare module "vitest" {
  export interface ProvidedContext {
    vectors: Record<string, unknown>;
    exportNames: Record<string, string[]>;
    ports: Record<string, number>;
  }
}

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

export default async function setup(project: TestProject) {
  const modules = import.meta.glob("../../src/**/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;
  const exportNames = Object.fromEntries(
    Object.entries(modules).map(([path, namespace]) => [path, Object.keys(namespace).sort()]),
  );
  project.provide("vectors", computeVectors());
  project.provide("exportNames", exportNames);

  const closers: Array<() => Promise<void>> = [];
  const ports: Record<string, number> = {};

  // An IdP that redirects. The first path segment is the scenario (`ok`,
  // `moved-discovery`, ...); `redirects.test.ts` rewrites `https://<scenario>.test/x`
  // to `http://127.0.0.1:<port>/<scenario>/x`. `/<scenario>/leak` is where a
  // redirect would land: it records whether a bearer token arrived there.
  const leaks: Array<{ path: string; authorization: string | null }> = [];
  const redirecting = createHttpServer((request, response) => {
    const [, scenario, ...rest] = new URL(request.url ?? "/", "http://x").pathname.split("/");
    const path = "/" + rest.join("/");
    const origin = `https://${scenario}.test`;
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const redirect = (to: string, status = 302) => {
      response.writeHead(status, { location: to });
      response.end();
    };
    // `r<status>-<call>`: the IdP answers that one call with that redirect, to another origin
    // (127.0.0.1 here, `<scenario>.test` for the client), and everything else normally.
    const scripted = /^r(\d{3})-(discovery|jwks|token|userinfo)$/.exec(scenario);
    const elsewhere = `http://127.0.0.1:${(request.socket.localPort as number)}/${scenario}/leak`;
    const redirectIf = (call: string) => scripted !== null && scripted[2] === call;
    if (scenario === "__leaks") return json(leaks);
    if (path === "/leak") {
      leaks.push({ path: `/${scenario}${path}`, authorization: request.headers.authorization ?? null });
      return json({ leaked: true });
    }
    if (path === "/.well-known/openid-configuration") {
      if (scenario === "moved-discovery") return redirect(`/${scenario}/leak`);
      if (redirectIf("discovery")) return redirect(elsewhere, Number(scripted?.[1]));
      return json({
        issuer: origin,
        authorization_endpoint: `${origin}/oidc/authorize`,
        userinfo_endpoint: `${origin}/oidc/userinfo`,
        jwks_uri: `${origin}/oidc/jwks`,
        token_endpoint: `${origin}/oidc/token`,
        management_api_base_url: `${origin}/api/v1`,
        management_api_audience: origin,
      });
    }
    if (path === "/oidc/jwks") {
      if (redirectIf("jwks")) return redirect(elsewhere, Number(scripted?.[1]));
      return json({ keys: [] });
    }
    if (path === "/oidc/userinfo") {
      if (redirectIf("userinfo")) return redirect(elsewhere, Number(scripted?.[1]));
      return json({ sub: "u" });
    }
    if (path === "/oidc/token") {
      if (scenario === "moved-token") return redirect(`/${scenario}/leak`);
      if (redirectIf("token")) return redirect(elsewhere, Number(scripted?.[1]));
      return json({ access_token: "registered-credential", token_type: "Bearer", expires_in: 60 });
    }
    if (path === "/api/v1/things" || path === "/api/v1/me/memberships") {
      if (scenario === "moved-resource") return redirect(`/${scenario}/leak`);
      return path === "/api/v1/things"
        ? json({ ok: true })
        : json({ items: [{ active: true, organization: { id: "11111111-2222-3333-4444-555555555555", display_name: "Acme" } }], page: { next_cursor: null } });
    }
    response.writeHead(404);
    response.end();
  });
  ports.redirecting = await new Promise<number>((resolve) =>
    redirecting.listen(0, "127.0.0.1", () => resolve((redirecting.address() as AddressInfo).port)),
  );
  closers.push(() => new Promise<void>((resolve) => redirecting.close(() => resolve())));

  // A port that was free a moment ago and has no listener: connection refused.
  // Taken AFTER the server above is bound: reserving it first and freeing it
  // before binding the other let that server land on it, and the "closed"
  // port then answered.
  const free = createServer();
  ports.closed = await listen(free);
  await new Promise((resolve) => free.close(resolve));

  project.provide("ports", ports);
  return async () => {
    for (const close of closers) await close();
  };
}
