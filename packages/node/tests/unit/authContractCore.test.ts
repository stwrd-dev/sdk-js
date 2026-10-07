/**
 * The same adapter contract as `router.test.ts`, served straight by the core's
 * `authHandler` and access guards with `Request` objects: no Express and no
 * socket (the fake IdP is in handler mode), the way a Worker calls them.
 */

import { StwrdCore } from "@stwrd-auth/core/client";
import { MemoryStore } from "@stwrd-auth/core/sessions";
import type { FetchLike } from "@stwrd-auth/core/oidc";
import { type AccessContext, type AccessRule, checkAccess, isPublicPath, resolveAccess } from "@stwrd-auth/core/web/access";
import { authHandler } from "@stwrd-auth/core/web/authHandler";
import { jsonResponse } from "@stwrd-auth/core/web/response";
import { readRequestCookie } from "@stwrd-auth/core/web/cookies";
import { FakeIdp } from "../fixtures/fakeIdp.js";
import { BASE_URL, CLIENT_ID, CLIENT_SECRET, RequestJar, authContractScenarios, type ContractAdapter } from "./authContractScenarios.js";

const GUARDS: Record<string, { rule: AccessRule; body: (context: AccessContext) => unknown }> = {
  "/private": { rule: { auth: true }, body: (context) => ({ sub: context.user?.id }) },
  "/guarded": { rule: { auth: true }, body: () => ({ ok: true }) },
  "/org-only": { rule: { org: true }, body: () => ({ ok: true }) },
  "/needs-role": { rule: { role: "org:admin" }, body: () => ({ ok: true }) },
  "/needs-permission": { rule: { permission: "members:invite" }, body: () => ({ ok: true }) },
};

const coreAdapter: ContractAdapter = {
  storeDownStatus: 500, // what a thrown error becomes in this harness, as in Express
  storeError: () => new Error("store down"),
  backChannelSink: true,
  backChannelFault: "sessions", // the default sink deletes through `stwrd.sessions`
  async make(options) {
    const idp = new FakeIdp({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: `${BASE_URL}/auth/callback`, mode: "handler", ...options.fakeIdp });
    const issuer = await idp.start();
    const real = idp.fetch as FetchLike;
    const stwrd = new StwrdCore({
      issuer,
      scope: "openid profile email offline_access org",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      baseUrl: BASE_URL,
      cookieSecret: "x".repeat(32),
      sessions: options.wrapSessions ? options.wrapSessions(new MemoryStore()) : undefined,
      fetch: options.wrapFetch ? options.wrapFetch(real) : real,
      ...options.config,
    });
    const handle = authHandler(stwrd, { backChannel: options.backChannel });

    async function app(request: Request): Promise<Response> {
      const served = await handle(request);
      if (served) return served;
      const url = new URL(request.url);
      const cookie = readRequestCookie(request.headers, stwrd.config.sessionCookie);
      const accept = request.headers.get("accept");
      const target = url.pathname + url.search;
      const resolved = await resolveAccess(stwrd, cookie);
      if (url.pathname === "/whoami") return jsonResponse({ sub: resolved.context.user?.id ?? null });
      const guard = GUARDS[url.pathname];
      if (guard) {
        const result = await checkAccess(stwrd, { accept, target, resolved }, guard.rule);
        return result.ok ? jsonResponse(guard.body(result.context)) : result.response;
      }
      if (options.protectAll && !isPublicPath(url.pathname, ["/public*"], stwrd.config.prefix)) {
        const result = await checkAccess(stwrd, { accept, target, resolved }, { auth: true });
        if (!result.ok) return result.response;
      }
      return url.pathname === "/public/info" || url.pathname === "/needs-session" ? jsonResponse({ ok: true }) : new Response(null, { status: 404 });
    }

    const jar = new RequestJar();
    return {
      idp,
      issuer,
      stwrd,
      jar,
      async call(path, init = {}) {
        const headers = new Headers(init.headers);
        if (jar.header()) headers.set("cookie", jar.header());
        const request = new Request(`${BASE_URL}${path}`, { method: init.method ?? "GET", headers, body: init.body ?? null });
        // An error the app did not handle is a 500, the way a server turns it into one.
        const response = await app(request).catch(() => new Response("Internal Server Error", { status: 500 }));
        jar.absorb(response);
        return response;
      },
      close: () => idp.stop(),
    };
  },
};

authContractScenarios("core handler", coreAdapter);
