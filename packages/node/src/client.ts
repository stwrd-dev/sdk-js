/**
 * `Stwrd` / `createStwrd` — the object an app builds once and hands to
 * `authRouter`/`attach`/the guards. Everything that does not touch Express
 * lives in `StwrdCore` (`@stwrd-auth/core/client`).
 */

import type { IncomingMessage } from "node:http";

import { StwrdCore, type StwrdOptions, stwrdOptionsFromEnv } from "@stwrd-auth/core/client";
import type { StwrdSession } from "@stwrd-auth/core/sessions";
import { attachMiddleware } from "./guards.js";
import { readCookie } from "./http.js";
import { type AuthRouterOptions, type ProtectAllOptions, authRouter, protectAllMiddleware } from "./router.js";

import type { RequestHandler, Router } from "express";

export type { StwrdOptions };

export class Stwrd extends StwrdCore {
  // The refresh tuning of `StwrdCore` is for adapters of other runtimes: the
  // Node SDK uses the defaults.
  constructor(options: StwrdOptions) {
    super(options);
  }

  /** Reads the `STWRD_*` variables from `env`, with `overrides` winning over
   * the environment. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env, overrides: Partial<StwrdOptions> = {}): Stwrd {
    return new Stwrd(stwrdOptionsFromEnv(env, overrides));
  }

  // --- Express wiring --------------------------------------------------

  /** Resolves the session once per request and caches it on `req.stwrd`.
   * Mount with `app.use(stwrd.attach())`, ahead of the guards and any route
   * that reads `req.stwrd`. */
  attach(): RequestHandler {
    return attachMiddleware(this);
  }

  /** The `/auth/*` routes, mounted under `config.prefix`. */
  authRouter(options: AuthRouterOptions = {}): Router {
    return authRouter(this, options);
  }

  /** The opt-in fail-closed guard: requires a session on every path that is
   * not declared public. */
  protectAll(options: ProtectAllOptions = {}): RequestHandler {
    return protectAllMiddleware(this, options);
  }

  async resolveSessionFromRequest(req: Pick<IncomingMessage, "headers">): Promise<StwrdSession | null> {
    return this.resolveSession(readCookie(req, this.config.sessionCookie));
  }

  async sessionFromRequest(req: Pick<IncomingMessage, "headers">): Promise<StwrdSession | null> {
    return this.sessionFromCookie(readCookie(req, this.config.sessionCookie));
  }
}

export function createStwrd(options: StwrdOptions): Stwrd {
  return new Stwrd(options);
}
