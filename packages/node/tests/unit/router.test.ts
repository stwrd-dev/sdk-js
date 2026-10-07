/**
 * `authRouter` and the guards, exercised end to end against the fake IdP
 * over a real local HTTP server. The scenarios are the adapter contract
 * in `authContractScenarios.ts`, shared with the core's handler and the
 * Worker adapter; this file is the Express harness that runs them.
 */

import express, { type Express } from "express";

import { Stwrd, createStwrd } from "../../src/client.js";
import { requireAuth, requireOrg, requirePermission, requireRole } from "../../src/guards.js";
import type { FetchLike } from "@stwrd-auth/core/oidc";
import { MemoryStore } from "@stwrd-auth/core/sessions";
import { FakeIdp } from "../fixtures/fakeIdp.js";
import { BASE_URL, CLIENT_ID, CLIENT_SECRET, authContractScenarios, type ContractAdapter } from "./authContractScenarios.js";
import { CookieJar, TestServer, jarFetch } from "./testServer.js";

function buildDemoApp(instance: Stwrd, options: { protected?: boolean } = {}): Express {
  const app = express();
  app.use(instance.attach());
  app.use(instance.authRouter());

  app.get("/whoami", (req, res) => {
    res.json({ sub: req.stwrd?.user?.id ?? null });
  });
  app.get("/private", requireAuth(instance), (req, res) => {
    res.json({ sub: req.stwrd?.user?.id });
  });
  app.get("/guarded", requireAuth(instance), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/org-only", requireOrg(instance), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/needs-role", requireRole(instance, "org:admin"), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/needs-permission", requirePermission(instance, "members:invite"), (_req, res) => {
    res.json({ ok: true });
  });

  if (options.protected) {
    app.use(instance.protectAll({ public: ["/public*"] }));
    app.get("/public/info", (_req, res) => res.json({ ok: true }));
    app.get("/needs-session", (_req, res) => res.json({ ok: true }));
  }

  return app;
}

const expressAdapter: ContractAdapter = {
  storeDownStatus: 500, // an error the app did not handle: Express's own
  storeError: () => new Error("store down"),
  backChannelSink: false, // `authRouter` has no option for it
  backChannelFault: "sessions",
  async make(options) {
    const idp = new FakeIdp({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: `${BASE_URL}/auth/callback`,
      ...options.fakeIdp,
    });
    const issuer = await idp.start();
    const real = fetch as FetchLike;
    const stwrd = createStwrd({
      issuer,
      scope: "openid profile email offline_access org",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      baseUrl: BASE_URL,
      cookieSecret: "x".repeat(32),
      cookieSecure: false, // real loopback http:// in this harness, not https
      sessions: options.wrapSessions ? options.wrapSessions(new MemoryStore()) : undefined,
      fetch: options.wrapFetch ? options.wrapFetch(real) : real,
      ...options.config,
    });
    const server = new TestServer();
    const baseUrl = await server.start(buildDemoApp(stwrd, { protected: options.protectAll }));
    const jar = new CookieJar();
    return {
      idp,
      issuer,
      stwrd,
      jar,
      call: (path, init = {}) => jarFetch(`${baseUrl}${path}`, { jar, ...init }),
      close: async () => {
        await server.stop();
        await idp.stop();
      },
    };
  },
};

authContractScenarios("express", expressAdapter);
