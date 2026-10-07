/**
 * The adapter contract (`authContractScenarios`, shared with the Express router
 * and the core's handler), served by the Worker adapter in workerd: `stwrdFor`,
 * its guards, and a Durable Object per session as the store.
 */
import { env as workerEnv } from "cloudflare:test";

import { Keyring } from "@stwrd-auth/core/keyring";
import { IdpUnavailable, type FetchLike } from "@stwrd-auth/core/oidc";
import { FakeIdp } from "../../../node/tests/fixtures/fakeIdp.js";
import { BASE_URL, CLIENT_ID, CLIENT_SECRET, RequestJar, authContractScenarios, type ContractAdapter } from "../../../node/tests/unit/authContractScenarios.js";
import { DurableObjectSessionStore } from "../../src/store.js";
import { type StwrdWorkers, stwrdFor } from "../../src/stwrd.js";

const KEY = new Uint8Array(32).fill(5);

/** The demo app of the contract (`ContractAdapter`), the way a Worker writes it. */
async function app(stwrd: StwrdWorkers, request: Request, protectAll: boolean): Promise<Response> {
  const served = await stwrd.handle(request);
  if (served) return served;
  const path = new URL(request.url).pathname;
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  if (path === "/whoami") {
    const { context, idpUnavailable } = await stwrd.resolve(request);
    // "Cannot tell" is not "nobody is signed in".
    if (idpUnavailable) return new Response("unavailable", { status: 503 });
    return json({ sub: context.user?.id ?? null });
  }
  const guards: Record<string, () => ReturnType<StwrdWorkers["requireAuth"]>> = {
    "/private": () => stwrd.requireAuth(request),
    "/guarded": () => stwrd.requireAuth(request),
    "/org-only": () => stwrd.requireOrg(request),
    "/needs-role": () => stwrd.requireRole(request, "org:admin"),
    "/needs-permission": () => stwrd.requirePermission(request, "members:invite"),
  };
  if (path in guards) {
    const result = await guards[path]();
    return result.ok ? json(path === "/private" ? { sub: result.context.user?.id } : { ok: true }) : result.response;
  }
  if (protectAll) {
    const denied = await stwrd.protect(request, { public: ["/public*"] });
    if (denied) return denied;
  }
  return path === "/public/info" || path === "/needs-session" ? json({ ok: true }) : new Response(null, { status: 404 });
}

const workersAdapter: ContractAdapter = {
  storeDownStatus: 503, // a store that does not answer is an IdP that does not answer
  storeError: () => new IdpUnavailable("store down", false),
  backChannelSink: true,
  backChannelFault: "sink", // the Durable Object does the deleting and the marking itself
  async make(options) {
    const idp = new FakeIdp({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: `${BASE_URL}/auth/callback`, mode: "handler", ...options.fakeIdp });
    const issuer = await idp.start();
    const real = idp.fetch as FetchLike;
    const variables = {
      STWRD_ISSUER: issuer,
      STWRD_CLIENT_ID: CLIENT_ID,
      STWRD_CLIENT_SECRET: CLIENT_SECRET,
      STWRD_BASE_URL: BASE_URL,
      STWRD_COOKIE_SECRET: "x".repeat(32),
      STWRD_SCOPE: "openid profile email offline_access org",
      STWRD_SESSION_KEYS: `k1:${Buffer.from(KEY).toString("base64url")}`,
      STWRD_SESSIONS: workerEnv.STWRD_SESSIONS,
    };
    // Without wrappers the adapter builds everything from `env` (the path an
    // app takes); with them, the same Durable Object store and sink are built
    // here so a scenario can break one method of them.
    let sessions: DurableObjectSessionStore | ReturnType<NonNullable<typeof options.wrapSessions>> | undefined;
    let backChannel = options.backChannel;
    if (options.wrapSessions || options.wrapBackChannel) {
      const keyring = new Keyring({ k1: KEY }, "k1");
      const namespace = `${issuer}|${CLIENT_ID}`;
      const store = new DurableObjectSessionStore(workerEnv.STWRD_SESSIONS, { namespace, keyring });
      sessions = options.wrapSessions ? options.wrapSessions(store) : store;
      const sink = store.backChannelSink();
      backChannel = options.wrapBackChannel ? options.wrapBackChannel(sink) : (backChannel ?? sink);
    }
    const stwrd = stwrdFor(variables, {
      fetch: options.wrapFetch ? options.wrapFetch(real) : real,
      sessions,
      backChannel,
      ...options.config,
    });
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
        // An error the app did not handle is a 500, the way the runtime turns it into one.
        const response = await app(stwrd, request, options.protectAll ?? false).catch(() => new Response("Internal Server Error", { status: 500 }));
        jar.absorb(response);
        return response;
      },
      close: () => idp.stop(),
    };
  },
};

authContractScenarios("workers", workersAdapter);
