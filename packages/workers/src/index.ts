/**
 * `@stwrd/workers` — the Cloudflare Workers SDK (BFF profile): the `/auth/*`
 * routes as a `Request → Response` handler, access guards for the app's own
 * routes, and a Durable Object that keeps each session. Same contract as
 * `@stwrd/node`: this module's exports are the public surface.
 */

export const VERSION = "0.1.2";

// --- the adapter -------------------------------------------------------------
export { SESSIONS_BINDING, StwrdWorkers, stwrdFor } from "./stwrd.js";
export type { GuardOptions, ProtectOptions, WorkersOptions } from "./stwrd.js";

// --- sessions: the Durable Object an app exports and binds as `STWRD_SESSIONS` ---
export { StwrdSessionObject } from "./sessionObject.js";
export type { ObjectClaim } from "./sessionObject.js";
export { DurableObjectSessionStore, SESSION_OBJECT_PREFIX, UNNAMED_NOTICE_OBJECT } from "./store.js";
export type { DurableObjectSessionStoreOptions, SessionObjects } from "./store.js";
export { SESSION_KEYS_ENV, parseSessionKeys } from "./sessionKeys.js";

// --- what an app reads and catches, from the shared core ---------------------
export { ConfigError } from "@stwrd/core/config";
export { Keyring } from "@stwrd/core/keyring";
export { IdpUnavailable, OidcError, RefreshUncertain } from "@stwrd/core/oidc";
export {
  MemoryStore,
  contextFromClaims,
  hasPermission,
  hasRole,
  sessionContext,
  sessionResponse,
  userFromClaims,
} from "@stwrd/core/sessions";
export { safeTarget } from "@stwrd/core/web/access";
export type { BackChannelSink } from "@stwrd/core/backchannel";
export type { FetchLike } from "@stwrd/core/oidc";
export type {
  Claims,
  ConsentState,
  RefreshClaim,
  SessionContext,
  SessionResponse,
  SessionStore,
  StwrdOrganization,
  StwrdSession,
  StwrdUser,
  Tokens,
} from "@stwrd/core/sessions";
export type { AccessContext, AccessResult, AccessRule, Resolution } from "@stwrd/core/web/access";
export type { WebhookEvent } from "@stwrd/core/webhooks";
