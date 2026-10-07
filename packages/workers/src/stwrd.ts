/**
 * `stwrdFor(env, options)` and `StwrdWorkers` — the object a Worker builds
 * once from its `env` and uses for the `/auth/*` routes (and, further down,
 * the guards). Counterpart of `Stwrd` in `@stwrd-auth/node`: everything that is
 * not about HTTP lives in `StwrdCore`, and the routes are the core's
 * `Request → Response` handler.
 *
 *   export default {
 *     async fetch(request: Request, env: Env) {
 *       const stwrd = stwrdFor(env);
 *       return (await stwrd.handle(request)) ?? app(request, env);
 *     },
 *   };
 *
 * Variables are the same as the other SDKs' (`STWRD_ISSUER`, ...), plus
 * `STWRD_SESSION_KEYS` (see `sessionKeys.ts`); sessions live in the Durable
 * Object bound as `STWRD_SESSIONS`. `MemoryStore` is only ever used when an app
 * passes it as `options.sessions` (tests): a Worker has no memory that outlives
 * a request, so it is not a default.
 */

import { type KeepAlive, type RefreshTuning, StwrdCore, type StwrdOptions, stwrdOptionsFromEnv } from "@stwrd-auth/core/client";
import { ConfigError, type EnvLike } from "@stwrd-auth/core/config";
import { IdpUnavailable } from "@stwrd-auth/core/oidc";
import {
  type AccessResult,
  type AccessRule,
  type Resolution,
  checkAccess,
  idpSilentResponse,
  isPublicPath,
  resolveAccess,
} from "@stwrd-auth/core/web/access";
import { readRequestCookie } from "@stwrd-auth/core/web/cookies";
import { type AuthHandlerOptions, authHandler } from "@stwrd-auth/core/web/authHandler";
import { parseSessionKeys } from "./sessionKeys.js";
import { DurableObjectSessionStore, type SessionObjects } from "./store.js";

/** The name of the Durable Object binding an app declares in its wrangler config. */
export const SESSIONS_BINDING = "STWRD_SESSIONS";

/** What differs from Node when a session is renewed.
 *
 * workerd gives no proof that an exchange never left (its `fetch` errors carry
 * no `cause.code`), so a failed exchange sends the session to `uncertain` for
 * good: the IdP is asked for its discovery document, with a timeout, right
 * before the exchange is marked as sent, so an IdP that is down costs a retry
 * and not a session. And every poll for another owner's refresh is a call to
 * a Durable Object: the wait grows (50, 100, 200, 400, then 800 ms) instead of
 * polling every 50 ms for ten seconds. */
export const WORKERS_REFRESH_TUNING: RefreshTuning = Object.freeze({
  waitS: 10,
  pollDelayMs: (attempt: number) => Math.min(50 * 2 ** attempt, 800),
  probeBeforeExchange: true,
});

export interface WorkersOptions extends Partial<StwrdOptions>, AuthHandlerOptions {}

/** What a Worker hands the adapter so a renewal outlives the request: its
 * `ExecutionContext` (only `waitUntil` is used). Optional everywhere; without
 * it a renewal ends with the request, as in Node. */
export type WaitUntilContext = Pick<ExecutionContext, "waitUntil">;

/** The keep-alive of a `ctx`, or `undefined` for none. A `ctx` that cannot
 * `waitUntil` is a `ConfigError` before anything is read: the usual cause is
 * `env` passed where the Worker's `ctx` goes, and the failure would otherwise
 * show up in the middle of a renewal, after the exchange was marked as sent. */
function keepAliveOf(ctx: WaitUntilContext | undefined): KeepAlive | undefined {
  if (ctx === undefined) return undefined;
  if (typeof (ctx as { waitUntil?: unknown } | null)?.waitUntil !== "function") {
    throw new ConfigError(
      "The ctx you passed has no waitUntil function: pass the ExecutionContext of the Worker (the third argument of fetch), not env.",
    );
  }
  return (work) => ctx.waitUntil(work);
}

export interface GuardOptions {
  /** Force a 401 JSON denial even for a browser navigation (the default sends
   * a navigation, `Accept: text/html`, to the sign-in route instead). */
  api?: boolean;
  /** The Worker's `ExecutionContext`: a session renewal it starts is kept
   * alive with `ctx.waitUntil`, so a person who closes the tab in the middle
   * of it does not leave the session `uncertain`. */
  ctx?: WaitUntilContext;
}

export interface ProtectOptions extends GuardOptions {
  /** Paths that need no session: an exact path, or a prefix ending in `*`.
   * Everything under the auth prefix is public without being listed. */
  public?: Iterable<string>;
}

export class StwrdWorkers extends StwrdCore {
  private readonly handler: (request: Request, keepAlive?: KeepAlive) => Promise<Response | null>;
  // One resolution per request object: the session is read (and maybe
  // renewed) once however many guards and handlers ask.
  private readonly resolutions = new WeakMap<Request, Promise<Resolution>>();

  constructor(options: StwrdOptions, hooks: AuthHandlerOptions = {}) {
    super(options, WORKERS_REFRESH_TUNING);
    this.handler = authHandler(this, hooks);
  }

  /** Serves the `/auth/*` routes. `null` for anything else (another path, or a
   * method the route does not take): the app routes it. A session store that
   * does not answer is a 503, like an IdP that does not answer; any other
   * error is the app's to see. Pass the Worker's `ctx` so a renewal survives
   * the person closing the tab. */
  async handle(request: Request, ctx?: WaitUntilContext): Promise<Response | null> {
    const keepAlive = keepAliveOf(ctx);
    try {
      return await this.handler(request, keepAlive);
    } catch (exc) {
      if (exc instanceof IdpUnavailable) {
        return idpSilentResponse();
      }
      throw exc;
    }
  }

  // --- guards ----------------------------------------------------------------

  /** The request's session context, for a route that works with or without a
   * person (no denial). `idpUnavailable` is the fact `context.user === null`
   * cannot carry: the IdP or the session store did not answer, so there is no
   * user to show — which is not the same as there being none. Render nothing
   * that says "signed out" when it is set. The first call for a request is the
   * one that reads the session, so it is the one whose `ctx` keeps a renewal alive. */
  async resolve(request: Request, ctx?: WaitUntilContext): Promise<Resolution> {
    const keepAlive = keepAliveOf(ctx);
    let resolution = this.resolutions.get(request);
    if (!resolution) {
      resolution = resolveAccess(this, readRequestCookie(request.headers, this.config.sessionCookie), keepAlive);
      this.resolutions.set(request, resolution);
    }
    return resolution;
  }

  private async guard(request: Request, rule: AccessRule, options: GuardOptions): Promise<AccessResult> {
    const url = new URL(request.url);
    return checkAccess(
      this,
      { accept: request.headers.get("accept"), target: url.pathname + url.search, api: options.api, resolved: await this.resolve(request, options.ctx) },
      rule,
    );
  }

  /** Every guard answers `{ ok: true, context }` or `{ ok: false, response }`
   * with the response that stops the request, in this order: IdP or store
   * silent → 503; no user → 401 JSON (or the 303 to sign-in for a navigation);
   * user but the rule fails → 403. */
  requireAuth(request: Request, options: GuardOptions = {}): Promise<AccessResult> {
    return this.guard(request, { auth: true }, options);
  }

  /** `org_roles` is an open registry: membership, never set equality. */
  requireRole(request: Request, role: string, options: GuardOptions = {}): Promise<AccessResult> {
    return this.guard(request, { role }, options);
  }

  requirePermission(request: Request, permission: string, options: GuardOptions = {}): Promise<AccessResult> {
    return this.guard(request, { permission }, options);
  }

  /** Needs the `org` scope in the configuration (`ConfigError` otherwise). */
  requireOrg(request: Request, options: GuardOptions = {}): Promise<AccessResult> {
    return this.guard(request, { org: true }, options);
  }

  /** The opt-in fail-closed guard: `null` lets the request through, a
   * `Response` stops it. It needs a session on every path that is not declared
   * public, answering what `requireAuth` answers. */
  async protect(request: Request, options: ProtectOptions = {}): Promise<Response | null> {
    keepAliveOf(options.ctx);
    const url = new URL(request.url);
    if (isPublicPath(url.pathname, [...(options.public ?? [])], this.config.prefix)) {
      return null;
    }
    const result = await this.requireAuth(request, options);
    return result.ok ? null : result.response;
  }
}

const instances = new WeakMap<object, { instance: StwrdWorkers; options: WorkersOptions }>();

// What defines the configuration: every option that is set and is not a
// function. Callbacks (`onUserRegistered`, `onEvent`, `fetch`) are not
// compared: declared inline in `fetch(req, env, ctx)` they are a new function
// on every request, and the first call's are the ones that count.
const present = (options: WorkersOptions): [string, unknown][] =>
  Object.entries(options).filter(([, value]) => value !== undefined && typeof value !== "function");

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
}

/** The same options: the same keys with the same values (an array by its
 * items, an object by identity; functions are not compared, see `present`). */
function sameOptions(a: WorkersOptions, b: WorkersOptions): boolean {
  const left = present(a);
  const right = present(b);
  return left.length === right.length && left.every(([key, value]) => key in b && sameValue(value, (b as Record<string, unknown>)[key]));
}

function isObjects(value: unknown): value is SessionObjects {
  const candidate = value as { idFromName?: unknown; get?: unknown } | null | undefined;
  return typeof candidate?.idFromName === "function" && typeof candidate?.get === "function";
}

/** The `StwrdWorkers` of this `env`: built on the first call (the options of
 * that first call are the ones that count) and reused after. A later call with
 * no options just gets it; one that changes a value option (issuer, client id,
 * scope, ...) is a `ConfigError`, because it would be silently ignored. The
 * callbacks (`onUserRegistered`, `onEvent`, `fetch`) are declared once: those
 * of the first call stay and those of later calls are ignored, without error,
 * so `stwrdFor(env, { onUserRegistered })` inside `fetch(req, env, ctx)` works
 * on every request. Fails closed with a `ConfigError` too when a required
 * variable, the `STWRD_SESSIONS` binding or `STWRD_SESSION_KEYS` is missing or
 * invalid. */
export function stwrdFor(env: object, options: WorkersOptions = {}): StwrdWorkers {
  // The core seals cookies with the `Buffer` global; without `nodejs_compat` it
  // is missing and the first request would fail somewhere far from the cause.
  if (typeof Buffer === "undefined") {
    throw new ConfigError(
      "The Buffer global is missing: turn on the nodejs_compat flag in wrangler.jsonc with a compatibility_date of 2024-09-23 or later (any date from 2026-08-04 on turns it on by itself).",
    );
  }
  const cached = instances.get(env);
  if (cached) {
    if (present(options).length > 0 && !sameOptions(cached.options, options)) {
      throw new ConfigError(
        "stwrdFor was already called for this env with other options; they would be ignored. Pass the same options every time, or build the instance once (callbacks are the exception: the first call's stay).",
      );
    }
    return cached.instance;
  }
  const { onUserRegistered, onEvent, backChannel, ...coreOverrides } = options;
  const coreOptions = stwrdOptionsFromEnv(env as EnvLike, coreOverrides);
  let sessions = coreOptions.sessions;
  let sink = backChannel;
  if (!sessions) {
    const objects = (env as Record<string, unknown>)[SESSIONS_BINDING];
    if (!isObjects(objects)) {
      throw new ConfigError(`The ${SESSIONS_BINDING} Durable Object binding is missing: declare it in wrangler.jsonc (see the README).`);
    }
    const keyring = parseSessionKeys((env as Record<string, unknown>).STWRD_SESSION_KEYS);
    // Sessions sealed for one issuer and client are not readable under another.
    const namespace = `${coreOptions.issuer}|${coreOptions.clientId}`;
    const store = new DurableObjectSessionStore(objects, { namespace, keyring });
    sessions = store;
    sink ??= store.backChannelSink();
  }
  const instance = new StwrdWorkers({ ...coreOptions, sessions }, { onUserRegistered, onEvent, backChannel: sink });
  instances.set(env, { instance, options });
  return instance;
}
