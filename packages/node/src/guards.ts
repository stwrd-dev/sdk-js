/**
 * `attach` and the Express guards — a thin Express shim over the core's
 * `checkAccess` (`@stwrd-auth/core/web/access`), which holds every decision: allow,
 * 401 JSON, 303 to sign-in, 403, and 503 when the IdP does not answer.
 *
 * Every factory below takes `stwrd` explicitly
 * (`requireRole(stwrd, "org:admin")`): there is no implicit registration step
 * to read it from instead.
 *
 * `attach()` exists because Express has no built-in per-request memoization.
 * It resolves the session once and caches it on `req.stwrd`; every guard
 * below reads that cache if present and falls back to resolving directly
 * otherwise, so a guard works whether or not `attach()` ran first.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
  type AccessContext,
  type AccessRule,
  type Resolution,
  IDP_SILENT,
  assertOrgRuleAvailable,
  checkAccess,
  resolveAccess,
  safeTarget,
} from "@stwrd-auth/core/web/access";
import type { Stwrd } from "./client.js";
import { readCookie } from "./http.js";
import { sendWebResponse } from "./webBridge.js";

/** What `attach()` leaves on `req.stwrd`: the user, the organization and the
 * consents as separate objects, plus the private session. */
export type StwrdContext = AccessContext;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      stwrd?: StwrdContext;
      stwrdApiMode?: boolean;
      /** The IdP did not answer while resolving this request: the context
       * above says `user: null` because there is nothing else to put there,
       * and **not** because there is no session. The guards check it to answer
       * 503 instead of sending someone who is still signed in to the login. */
      stwrdIdpUnavailable?: boolean;
    }
  }
}

/** Resolves the request's session once and caches it on the request. */
export async function resolveRequest(stwrd: Stwrd, req: Request): Promise<Resolution> {
  if (req.stwrd) {
    return { context: req.stwrd, idpUnavailable: req.stwrdIdpUnavailable === true };
  }
  const resolution = await resolveAccess(stwrd, readCookie(req, stwrd.config.sessionCookie));
  // Marked and NOT raised: an unguarded public route renders anyway (it has no
  // session to lose) and each guard decides for itself.
  if (resolution.idpUnavailable) {
    req.stwrdIdpUnavailable = true;
  }
  req.stwrd = resolution.context;
  return resolution;
}

/** One guard per rule: the core decides, this only carries the request in and
 * the response out. */
export function guard(stwrd: Stwrd, rule: AccessRule): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const resolved = await resolveRequest(stwrd, req);
      const result = await checkAccess(
        stwrd,
        { accept: req.headers.accept, target: req.originalUrl ?? req.url, api: req.stwrdApiMode, resolved },
        rule,
      );
      if (!result.ok) {
        await sendWebResponse(res, result.response);
        return;
      }
      next();
    })().catch(next);
  };
}

/** Resolves the session once per request and caches it on `req.stwrd`,
 * ahead of route handlers and any guard below. The public entry point is the
 * bound method `Stwrd.attach`; this is its implementation. */
export function attachMiddleware(stwrd: Stwrd): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    resolveRequest(stwrd, req)
      .then(() => next())
      .catch(next);
  };
}

/** Forces a 401 JSON denial on this route even for a browser navigation. */
export function apiMode(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.stwrdApiMode = true;
    next();
  };
}

/** A guard with no return value beyond "must be signed in" — does not read
 * the user, unlike a route handler that reads `req.stwrd.user` directly
 * after this passes. */
export function requireAuth(stwrd: Stwrd): RequestHandler {
  return guard(stwrd, { auth: true });
}

/** Requires a role. `org_roles` is an open registry: the check is membership,
 * never set equality. */
export function requireRole(stwrd: Stwrd, role: string): RequestHandler {
  return guard(stwrd, { role });
}

export function requireOrg(stwrd: Stwrd): RequestHandler {
  assertOrgRuleAvailable(stwrd);
  return guard(stwrd, { org: true });
}

export function requirePermission(stwrd: Stwrd, permission: string): RequestHandler {
  return guard(stwrd, { permission });
}

// `safeTarget` lives in the core, next to the guards that use it; this entry
// point keeps exporting it.
export { IDP_SILENT, safeTarget };
