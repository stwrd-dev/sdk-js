# Changelog

All notable changes to this package are documented in this file.

The format is based on Keep a Changelog 1.1.0, and this package adheres to Semantic Versioning (SemVer).

## [0.1.0] - Unreleased

Initial release.

### Added

- Configuration resolution (`resolveConfig`, `configFromEnv`, `stwrdOptionsFromEnv`) with fail-closed validation and `ConfigError`.
- `StwrdCore`: session resolution with expiry and token renewal, HMAC-signed cookie sealing, CSRF tokens and webhook verification, independent of any web framework or runtime.
- OpenID Connect relying-party client (`OidcClient`): discovery, JWKS caching, authorization-code flow with PKCE, ID token and logout token validation, refresh-token exchange, userinfo. Redirects are never followed.
- Distinct errors for a rejection by the identity provider (`OidcError`) and for no answer (`IdpUnavailable`, `RefreshUncertain`).
- Session store contract (`SessionStore`) with a refresh lease and fencing, so a refresh token is exchanged at most once across processes, plus the in-memory `MemoryStore`.
- `Keyring` for encrypting stored sessions (JWE `dir` + `A256GCM`) with key rotation.
- `authHandler`: the `/auth/*` routes (sign-in, callback, sign-out, session, organizations, back-channel logout, webhook) as a `Request` to `Response` function.
- Access guards on `Request` and `Response` (`checkAccess`, `resolveAccess`, `safeTarget`, `isPublicPath`).
- Back-channel logout bookkeeping (`BackChannelSink`, `MemoryBackChannelSink`).
- Standard Webhooks signature verification and signing (`verifyWebhook`, `signWebhook`) with replay window and `SeenEventIds` deduplication.
- Typed Management API client (`createManagement`) with discovery validation, token caching and cursor iteration.
- Cookie, bounded request-body and response helpers.
