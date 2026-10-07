# Changelog

All notable changes to this package are documented in this file.

The format is based on Keep a Changelog 1.1.0, and this package adheres to Semantic Versioning (SemVer).

## [0.1.0] - Unreleased

Initial release.

### Added

- `stwrdFor(env, options)` and `StwrdWorkers`: the `/auth/*` routes as a `Request` to `Response` handler for Cloudflare Workers.
- Guards: `requireAuth`, `requireRole`, `requirePermission`, `requireOrg`, `protect` and `resolve`.
- `StwrdSessionObject`, a SQLite-backed Durable Object that keeps one session and its refresh lease, and `DurableObjectSessionStore`, which seals sessions as JWE with `STWRD_SESSION_KEYS`.
- Key rotation for `STWRD_SESSION_KEYS`.
- Optional `ctx` support: session renewals run under `ctx.waitUntil` so they finish after the request ends.
- Back-channel logout and webhook routes.
