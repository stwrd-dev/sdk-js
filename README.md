# stwrd SDK for JavaScript

[![CI](https://github.com/stwrd-dev/sdk-js/actions/workflows/ci.yml/badge.svg)](https://github.com/stwrd-dev/sdk-js/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

JavaScript and TypeScript SDKs for [stwrd](https://stwrd.dev), a multi-tenant identity provider. They implement the backend-for-frontend (BFF) profile: your server performs the OpenID Connect flow and keeps the tokens, and the browser holds only a signed session cookie. Every package is ESM only and ships its own TypeScript declarations.

## Packages

| Package | Description | Install |
|---|---|---|
| [`@stwrd-auth/node`](packages/node) | Node.js and Express: the `/auth/*` routes, server-side sessions, route guards and webhook verification. | `npm install @stwrd-auth/node express` |
| [`@stwrd-auth/workers`](packages/workers) | Cloudflare Workers: the `/auth/*` handler, route guards and a Durable Object session store. | `npm install @stwrd-auth/workers` |
| [`@stwrd-auth/react`](packages/react) | React: a session provider, hooks and components that read the session from your server. | `npm install @stwrd-auth/react` |
| [`@stwrd-auth/core`](packages/core) | The runtime-neutral core the other packages build on: configuration, OIDC client, sessions, signed cookies, webhook verification and the Management API transport. | `npm install @stwrd-auth/core` |

## Which package to use

- An Express app on Node.js: `@stwrd-auth/node`.
- A Cloudflare Worker: `@stwrd-auth/workers`.
- A React front end: `@stwrd-auth/react`, next to one of the two server packages above. It talks to the `/auth/*` routes that the server package serves on the same origin.
- Another runtime, webhook verification on its own, or the typed Management client without a framework: `@stwrd-auth/core`.

The server packages pin `@stwrd-auth/core` to an exact version, so installing one of them is enough.

## Repository layout

This is an npm workspace. Each package lives under `packages/` and has its own README, changelog and license file.

```sh
npm ci
npm run build
npm run lint
npm test
```

Requires Node.js 20 or newer. The PostgreSQL session store tests need a PostgreSQL server; they read its address from `STWRD_TEST_DB_URL` (default `postgresql://stwrd:stwrd@localhost:55432/stwrd_test`) and create and drop their own databases.

## Versioning

The four packages are released together under one version number and follow [Semantic Versioning](https://semver.org). While the version is below 1.0, minor releases may contain breaking changes.

## Support

Report problems and ask questions in the [issue tracker](https://github.com/stwrd-dev/sdk-js/issues). The Security section of each package README describes how that package handles cookies, tokens and secrets.

## Security

Supported versions and how to report a vulnerability are described in the [security policy](https://github.com/stwrd-dev/sdk-js/security/policy). Do not report vulnerabilities in public issues.

## License

[MIT](LICENSE)
