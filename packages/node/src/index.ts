/**
 * `@stwrd-auth/node` — the Node SDK (BFF profile).
 *
 * This module's exports are the public surface; every name here is part of
 * the package's API.
 */

export const VERSION = "0.1.0";

// --- config ------------------------------------------------------------
export {
  COOKIE_SECRET_MIN_LEN,
  ConfigError,
  ENV_PREFIX,
  REQUIRED_ENV,
  resolveConfig,
} from "@stwrd-auth/core/config";
export { configFromEnv } from "./env.js";
export type { OidcParams, ResolvedConfig, StwrdConfigOptions } from "@stwrd-auth/core/config";

// --- crypto / session primitives ---------------------------------------
export { csrfToken, sign, unsign } from "@stwrd-auth/core/crypto";

// --- sessions ------------------------------------------------------------
export { MemoryStore, accessExpiry, hasPermission, hasRole, userFromClaims, sessionContext, sessionResponse, contextFromClaims } from "@stwrd-auth/core/sessions";
export type {
  Claims,
  SessionResponse,
  SessionContext,
  StwrdOrganization,
  ConsentState,
  RefreshClaim,
  RefreshPhase,
  SessionStore,
  StwrdSession,
  StwrdUser,
  Tokens,
} from "@stwrd-auth/core/sessions";

// --- OIDC ------------------------------------------------------------
export {
  JWKS_DEFAULT_TTL_S,
  JWKS_TTL_CEILING_S,
  JWKS_TTL_FLOOR_S,
  JWKS_UNKNOWN_KID_REFETCH_FLOOR_S,
  IdpUnavailable,
  RefreshUncertain,
  LOGOUT_EVENT_URI,
  OidcClient,
  OidcError,
  RETRY_STATUSES,
  challengeS256,
  generateVerifier,
  halfHash,
  newAuthorizationState,
  newNonce,
  newState,
} from "@stwrd-auth/core/oidc";
export type { AuthorizationState, Awaitable, Discovery, FetchLike, Transaction } from "@stwrd-auth/core/oidc";

// --- webhooks ------------------------------------------------------------
export {
  DEDUP_WINDOW_S,
  HEADER_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  SIGNATURE_PREFIX,
  TOLERANCE_S,
  DuplicateEventError,
  InvalidSignatureError,
  SeenEventIds,
  safeEqual,
  signWebhook,
  verifyWebhook,
  verifyWebhookSignature,
} from "./webhooks.js";
export type { SeenStore, VerifyWebhookOptions, WebhookEvent } from "./webhooks.js";

// --- the Stwrd instance --------------------------------------------------
export { Stwrd, createStwrd } from "./client.js";

// A `FetchLike` for developing against a local IdP that routes by `Host`.
export { makeHostFetch } from "./hostFetch.js";
export type { HostFetchOptions } from "./hostFetch.js";
export type { StwrdOptions } from "./client.js";

// --- Express wiring: guards ------------------------------------------------
export {
  apiMode,
  requireAuth,
  requireOrg,
  requirePermission,
  requireRole,
  safeTarget,
} from "./guards.js";
export type { StwrdContext } from "./guards.js";

// --- Express wiring: router ------------------------------------------------
export type { AuthRouterOptions, ProtectAllOptions } from "./router.js";
