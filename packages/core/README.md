# @stwrd-auth/core

The runtime-neutral core shared by the stwrd JavaScript SDKs: configuration, an OpenID Connect relying-party client, server-side sessions with a refresh lease, signed cookies, webhook verification and the Management API transport.

## What it is

[stwrd](https://stwrd.dev) is a multi-tenant identity provider. This package holds the logic that does not depend on a web framework or a runtime. It has no HTTP server and no framework integration of its own: applications normally install an adapter, and the adapter builds on this package.

| Package | Use it for |
|---|---|
| [`@stwrd-auth/node`](https://www.npmjs.com/package/@stwrd-auth/node) | Express apps |
| [`@stwrd-auth/workers`](https://www.npmjs.com/package/@stwrd-auth/workers) | Cloudflare Workers |
| [`@stwrd-auth/react`](https://www.npmjs.com/package/@stwrd-auth/react) | React front ends that talk to one of the two above |

Install this package directly to write an adapter for another runtime, to verify stwrd webhooks on their own, or to use the typed Management client without an adapter.

## Installation

```sh
npm install @stwrd-auth/core
```

Requires Node.js 18 or newer, or any runtime that provides the Fetch API (`Request`, `Response`, `Headers`) and `node:crypto` (Cloudflare Workers with the `nodejs_compat` compatibility flag). The only runtime dependency is [`jose`](https://www.npmjs.com/package/jose) (`^6`). The package is ESM only and ships its own TypeScript declarations.

Each module is a subpath export; there is no root entry point (`import ... from "@stwrd-auth/core/client"`). The adapters pin this package to an exact version, so install both from the same release.

## Minimal example

A server for any runtime that speaks `Request` and `Response` (Bun, Deno, Workers). The handler serves the `/auth/*` routes and returns `null` for any other path:

```ts
import { StwrdCore, stwrdOptionsFromEnv } from "@stwrd-auth/core/client";
import { authHandler } from "@stwrd-auth/core/web/authHandler";

const stwrd = new StwrdCore(stwrdOptionsFromEnv(process.env));
const handle = authHandler(stwrd);

export default {
  async fetch(request: Request): Promise<Response> {
    return (await handle(request)) ?? new Response("Not found", { status: 404 });
  },
};
```

Without a `sessions` option the sessions live in process memory (`MemoryStore`), which suits development and a single process. For several processes, pass a shared store that implements `SessionStore`; `@stwrd-auth/node/postgres` and `@stwrd-auth/workers` ship two.

Verifying a webhook delivery, with the raw request body and the request headers:

```ts
import { SeenEventIds, verifyWebhook } from "@stwrd-auth/core/webhooks";

const seen = new SeenEventIds();

export function receive(rawBody: string | Buffer, headers: Record<string, string>) {
  // Throws InvalidSignatureError or DuplicateEventError.
  return verifyWebhook(rawBody, headers, process.env.STWRD_WEBHOOK_SECRET!, { seen });
}
```

## Configuration

`new StwrdCore(options)` and `resolveConfig(options)` validate the options and throw `ConfigError` when one is missing or invalid. `stwrdOptionsFromEnv(env, overrides?)` reads them from an environment object; the core never reads a global environment of its own.

| Option | Environment variable | Required | Default | Description |
|---|---|---|---|---|
| `issuer` | `STWRD_ISSUER` | yes | | Issuer URL of the tenant. |
| `clientId` | `STWRD_CLIENT_ID` | yes | | OIDC client ID of the application. |
| `clientSecret` | `STWRD_CLIENT_SECRET` | yes | | Client secret of the application. |
| `baseUrl` | `STWRD_BASE_URL` | yes | | Public URL of the application. `{baseUrl}{prefix}/callback` is the redirect URI. |
| `cookieSecret` | `STWRD_COOKIE_SECRET` | yes | | HMAC key of the session cookie, at least 32 characters. |
| `scope` | `STWRD_SCOPE` | no | `openid profile email offline_access` | Requested scopes. Add `org` to enable organizations. |
| `webhookSecret` | `STWRD_WEBHOOK_SECRET` | no | none | Without it `/auth/webhook` answers 503. |
| `prefix` | `STWRD_PREFIX` | no | `/auth` | Path prefix of the routes. |
| `sessionTtlS` | `STWRD_SESSION_TTL_S` | no | `28800` | Sliding session lifetime in seconds. |
| `cookieSecure` | `STWRD_COOKIE_SECURE` | no | `true` | `Secure` attribute of the cookies. |
| `postLoginRedirect` | `STWRD_POST_LOGIN_REDIRECT` | no | `/` | Destination when a sign-in has no `return_to`. |
| `postLogoutRedirect` | `STWRD_POST_LOGOUT_REDIRECT` | no | `/` | Destination after sign-out. |
| `sessionCookie` | | no | `__Host-stwrd_session` | Name of the session cookie. |
| `txCookie` | | no | `__Host-stwrd_tx` | Name of the sign-in transaction cookie. |
| `transactionTtlS` | | no | `600` | Lifetime of a pending sign-in, in seconds. |
| `sessions` | | no | `MemoryStore` | A `SessionStore`. |
| `fetch` | | no | `globalThis.fetch` | The `fetch` used for every request to the identity provider. |

## API reference

| Subpath | Exports |
|---|---|
| `@stwrd-auth/core/client` | `StwrdCore` (sessions, cookie sealing, CSRF, webhook verification, organization listing), `stwrdOptionsFromEnv`, `RefreshTuning`, `KeepAlive` |
| `@stwrd-auth/core/config` | `resolveConfig`, `configFromEnv`, `stwrdConfigFromEnv`, `ConfigError`, defaults and option types |
| `@stwrd-auth/core/oidc` | `OidcClient`, `OidcError`, `IdpUnavailable`, `RefreshUncertain`, PKCE and `state` helpers |
| `@stwrd-auth/core/sessions` | `SessionStore`, `MemoryStore`, `StwrdSession`, `StwrdUser`, `StwrdOrganization`, `sessionContext`, `sessionResponse`, `hasRole`, `hasPermission` |
| `@stwrd-auth/core/keyring` | `Keyring`: named 32-byte keys that encrypt stored sessions (JWE `dir` + `A256GCM`) |
| `@stwrd-auth/core/backchannel` | `BackChannelSink`, `MemoryBackChannelSink` |
| `@stwrd-auth/core/webhooks` | `verifyWebhook`, `verifyWebhookSignature`, `signWebhook`, `SeenEventIds`, `InvalidSignatureError`, `DuplicateEventError` |
| `@stwrd-auth/core/management` | `createManagement`, `ManagementClient`, `ManagementError`: typed Management API client |
| `@stwrd-auth/core/crypto` | `sign`, `unsign`, `csrfToken` |
| `@stwrd-auth/core/web/authHandler` | `authHandler(stwrd, options?)`: the `/auth/*` routes as `(Request) => Promise<Response \| null>` |
| `@stwrd-auth/core/web/access` | `checkAccess`, `resolveAccess`, `safeTarget`, `isPublicPath`: the access guards on `Request` and `Response` |
| `@stwrd-auth/core/web/cookies`, `body`, `response` | Cookie, bounded body-reading and response helpers |

### Routes served by `authHandler`

| Route | Behavior |
|---|---|
| `GET {prefix}/sign-in` | Starts the authorization-code flow with PKCE; accepts `return_to`; other query parameters are ignored. |
| `GET {prefix}/callback` | Completes the flow, creates the session and sets the session cookie. |
| `POST {prefix}/sign-out` | Ends the session. Requires the CSRF token (`x-csrf-token` header or `csrf_token` form field). |
| `GET {prefix}/session` | JSON: `authenticated`, `user`, `organization`, `consents`, `csrf_token`, `account_url`. |
| `GET {prefix}/organizations`, `POST {prefix}/organization` | List the person's organizations and switch the active one (requires the `org` scope). |
| `POST {prefix}/back-channel` | Receives OIDC back-channel logout notices. |
| `POST {prefix}/webhook` | Receives and verifies webhook deliveries. |

### Management client

```ts
import { createManagement } from "@stwrd-auth/core/management";

const api = createManagement({
  issuer: process.env.STWRD_ISSUER!,
  clientId: process.env.STWRD_MANAGEMENT_CLIENT_ID!,
  clientSecret: process.env.STWRD_MANAGEMENT_CLIENT_SECRET!,
  scopes: ["mgmt:users:read"],
});

for await (const user of api.users.iterate()) {
  console.log(user.id);
}
```

Use it on a server only; never ship Management credentials to a browser. The client validates the discovery document before it sends any credential, refuses redirects, caches access tokens per validated destination and never retries a write on its own. Errors are `ManagementError` instances with `status`, `body` and `requestId`.

## Security

- Session cookies are HMAC-signed (tamper-evident, not encrypted) and carry only an opaque session identifier. Access, ID and refresh tokens stay in the server-side store and are never sent to the browser.
- By default the cookies use the `__Host-` prefix and are `HttpOnly`, `Secure` and `SameSite=Lax`.
- Authorization-code flows use PKCE (`S256`), `state` and `nonce`. ID tokens are verified for signature (`RS256` or `EdDSA`), issuer, audience, expiry, `nonce` and `at_hash`. The algorithm list is fixed and never read from the token.
- Requests to the identity provider never follow redirects, so a redirect cannot carry a secret to another host. The redirect URI is built from `baseUrl`, never from the `Host` header.
- State-changing routes (`sign-out`, organization switch) require a CSRF token derived from the session. Redirect targets taken from requests go through `safeTarget`: only paths of the same application are allowed.
- Webhook signatures are compared in constant time, with a 300-second replay window. Deduplication by event `id` is process-local; a receiver that needs a hard guarantee must also deduplicate in its own storage.
- Request bodies are read with a size ceiling measured on the stream (100 KiB for forms and JSON, 5 MiB for webhooks).
- Across the processes that share a session store, a refresh token is exchanged at most once (a lease with fencing). When a refresh may have been processed but its result was not stored, the session becomes `uncertain` and the person signs in again; the consumed token is never replayed.

Keep `cookieSecret`, `clientSecret`, `webhookSecret` and any session keyring out of source control and out of logs.

Supported versions and how to report a vulnerability are described in the [security policy](https://github.com/stwrd-dev/sdk-js/security/policy).

## Error handling and troubleshooting

| Error | Meaning | What to do |
|---|---|---|
| `ConfigError` | A required option is missing or invalid, or an option has the wrong type. | Fix the configuration; the process should not start. |
| `OidcError` | The identity provider answered and rejected the request (bad code, invalid token). | Treat the sign-in or the session as invalid. |
| `IdpUnavailable` | The identity provider, or the session store, did not answer. `requestSent` says whether a request may have been processed. | Answer 503 and keep the session; retry later. |
| `RefreshUncertain` | A refresh may have been processed without its result being stored. | Send the person through `/auth/sign-in`. |
| `InvalidSignatureError` | The webhook headers, timestamp or signature are not valid. | Answer 400. |
| `DuplicateEventError` | The webhook event `id` was already processed. | Answer 200 without reprocessing. |
| `ManagementError` | The Management API answered with an error status. | Read `status`, `body` and `requestId`. |

When the identity provider does not answer, the routes and guards answer 503 and never 401, so a person with a live session is not told that they signed out.

## Compatibility

- Node.js 18 or newer; Cloudflare Workers with `nodejs_compat`. The test suite runs on both Node and workerd.
- ESM only. TypeScript declarations are included; they resolve under `node10`, `nodenext` and `bundler` module resolution.
- Browsers are not supported: this package holds server-side secrets.

## Versioning

This package follows Semantic Versioning (SemVer). While the version is below 1.0, minor releases may contain breaking changes. Changes are listed in `CHANGELOG.md`.

## License

MIT © 2026 stwrd. See `LICENSE`.
