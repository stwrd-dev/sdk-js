# Changelog

All notable changes to this package are documented in this file.

The format is based on Keep a Changelog 1.1.0, and this package adheres to Semantic Versioning (SemVer).

## [0.1.0] - Unreleased

Initial release.

### Added

- `Stwrd` and `createStwrd`, with `Stwrd.fromEnv()` reading the `STWRD_*` environment variables.
- `authRouter()`: Express router for the `/auth/sign-in`, `/auth/callback`, `/auth/sign-out`, `/auth/session`, `/auth/organizations`, `/auth/organization`, `/auth/back-channel` and `/auth/webhook` routes, with `onUserRegistered` and `onEvent` hooks.
- `attach()` middleware that resolves the session once per request into `req.stwrd`.
- Guards: `requireAuth`, `requireRole`, `requirePermission`, `requireOrg` and `apiMode`.
- `protectAll()`: opt-in fail-closed protection of an entire app by path.
- Server-side sessions, signed `__Host-` session cookie, CSRF protection and automatic token renewal.
- Organization selection when the `org` scope is requested.
- Webhook verification (`@stwrd-auth/node/webhooks`).
- Typed Management API client (`@stwrd-auth/node/management`).
- PostgreSQL session store with encrypted sessions and a refresh lease (`@stwrd-auth/node/postgres`).
- `makeHostFetch` for developing against a local identity provider that routes by `Host`.
