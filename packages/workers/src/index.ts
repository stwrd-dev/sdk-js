/**
 * `@stwrd-auth/workers` — the Cloudflare Workers SDK (BFF profile): the `/auth/*`
 * routes as a `Request → Response` handler, access guards for the app's own
 * routes, and a Durable Object that keeps each session. Same contract as
 * `@stwrd-auth/node`: this module's exports are the public surface.
 */

export const VERSION = "0.1.0";

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
export { ConfigError } from "@stwrd-auth/core/config";
export { Keyring } from "@stwrd-auth/core/keyring";
export { IdpUnavailable, OidcError, RefreshUncertain } from "@stwrd-auth/core/oidc";
export {
  MemoryStore,
  contextFromClaims,
  hasPermission,
  hasRole,
  sessionContext,
  sessionResponse,
  userFromClaims,
} from "@stwrd-auth/core/sessions";
export { safeTarget } from "@stwrd-auth/core/web/access";
export type { BackChannelSink } from "@stwrd-auth/core/backchannel";
export type { FetchLike } from "@stwrd-auth/core/oidc";
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
} from "@stwrd-auth/core/sessions";
export type { AccessContext, AccessResult, AccessRule, Resolution } from "@stwrd-auth/core/web/access";
export type { WebhookEvent } from "@stwrd-auth/core/webhooks";
