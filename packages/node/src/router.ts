/**
 * `authRouter` and `protectAll` — a thin Express shim over the core's
 * `authHandler` (`@stwrd-auth/core/web/authHandler`), which serves the routes
 * under `stwrd.config.prefix`, and over `checkAccess` for the opt-in
 * fail-closed middleware. The Python SDK's FastAPI integration behaves the
 * same way.
 */

import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";

import { type AuthHandlerOptions, authHandler } from "@stwrd-auth/core/web/authHandler";
import { checkAccess, isPublicPath } from "@stwrd-auth/core/web/access";
import type { StwrdUser } from "@stwrd-auth/core/sessions";
import type { WebhookEvent } from "@stwrd-auth/core/webhooks";
import type { Stwrd } from "./client.js";
import { readCookie } from "./http.js";
import { sendWebResponse, toWebRequest } from "./webBridge.js";
import { resolveRequest } from "./guards.js";

export interface AuthRouterOptions {
  onUserRegistered?: (user: StwrdUser) => unknown | Promise<unknown>;
  onEvent?: (event: WebhookEvent) => unknown | Promise<unknown>;
}

/**
 * Serves the `/auth/*` routes under `stwrd.config.prefix`: every
 * request goes to the core's handler, and one it does not serve (another path,
 * a method the route does not take) falls through to the app.
 *
 * `onUserRegistered(user)` runs once per successful `/auth/callback`.
 * Whether this is the very first login for that `sub` is the app's own
 * question, so the hook fires on every login and an idempotent upsert on
 * the app's side is what makes "registered" mean the first one.
 * `onEvent(event)` runs once per accepted `/auth/webhook` delivery, after
 * dedup.
 */
export function authRouter(stwrd: Stwrd, options: AuthRouterOptions = {}): Router {
  const handle = authHandler(stwrd, options satisfies AuthHandlerOptions);
  const prefix = stwrd.config.prefix.replace(/\/$/, "").toLowerCase();
  const router = express.Router();
  router.use((req: Request, res: Response, next: NextFunction) => {
    // Cheap exit for everything outside the prefix: no `Request` is built and
    // the app's own body is left alone.
    if (!req.path.toLowerCase().startsWith(`${prefix}/`)) {
      next();
      return;
    }
    void (async () => {
      const webRequest = toWebRequest(req, stwrd);
      const response = webRequest === null ? null : await handle(webRequest);
      if (response === null) {
        next();
        return;
      }
      await sendWebResponse(res, response);
    })().catch(next);
  });
  return router;
}

export interface ProtectAllOptions {
  public?: Iterable<string>;
}

/** Fail-closed mode is opt-in (`protectAll({public})`): it requires a session
 * on every path that is not declared public. Implementation behind
 * `Stwrd.protectAll`. */
export function protectAllMiddleware(stwrd: Stwrd, options: ProtectAllOptions = {}): RequestHandler {
  const publicList = [...(options.public ?? [])];
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      if (isPublicPath(req.path, publicList, stwrd.config.prefix)) {
        next();
        return;
      }
      const resolved = await resolveRequest(stwrd, req);
      const result = await checkAccess(
        stwrd,
        { cookie: readCookie(req, stwrd.config.sessionCookie), accept: req.headers.accept, target: req.originalUrl ?? req.url, api: req.stwrdApiMode, resolved },
        { auth: true },
      );
      if (!result.ok) {
        // A silent IdP is a 503, not the 401 or the redirect to sign-in: both
        // tell someone with a live session that they lost it.
        await sendWebResponse(res, result.response);
        return;
      }
      next();
    })().catch(next);
  };
}
