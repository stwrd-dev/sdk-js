# @stwrd-auth/workers

stwrd SDK for Cloudflare Workers (backend-for-frontend profile): the `/auth/*` routes as a `Request` to `Response` handler, guards for your own routes, and a Durable Object that keeps each session on the server.

## What it is

[stwrd](https://stwrd.dev) is a multi-tenant identity provider. In the backend-for-frontend (BFF) profile the server performs the OpenID Connect flow and keeps the tokens; the browser only holds a signed cookie. This package runs that profile inside a Worker. It exposes the same routes, the same `GET /auth/session` JSON and the same `STWRD_*` variables as [`@stwrd-auth/node`](https://www.npmjs.com/package/@stwrd-auth/node) and the Python SDK (`stwrd-auth` on PyPI), so a front end such as [`@stwrd-auth/react`](https://www.npmjs.com/package/@stwrd-auth/react) works unchanged. A person's `user.id` is the `sub` claim of the identity provider: global and stable.

## Installation

```sh
npm install @stwrd-auth/workers
```

[`@stwrd-auth/core`](https://www.npmjs.com/package/@stwrd-auth/core) is a dependency, pinned to the exact version that ships with this release. Requirements:

- Node.js 20 or newer for the tooling (`wrangler`).
- The `nodejs_compat` compatibility flag with a `compatibility_date` of 2024-09-23 or later (any date from 2026-08-04 on enables the flag by itself). Without the flag the Worker does not start, because `node:crypto` cannot be imported. With the flag but an earlier date, `stwrdFor` throws a `ConfigError` because the `Buffer` global is missing.
- A Durable Object binding named `STWRD_SESSIONS` (below).

The package is ESM only and ships its own TypeScript declarations.

## Minimal example

`wrangler.jsonc`: the flag, the binding of the session object and the migration that creates it as a SQLite-backed class.

```jsonc
// What an app's wrangler config needs for `@stwrd-auth/workers`: the
// `nodejs_compat` flag, the Durable Object binding named STWRD_SESSIONS, and
// the migration that creates the class as SQLite-backed. (Secrets are not
// here: `wrangler secret put STWRD_COOKIE_SECRET`, ...)
{
  "name": "my-worker",
  "main": "./index.ts",
  "compatibility_date": "2026-08-22",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": { "bindings": [{ "name": "STWRD_SESSIONS", "class_name": "StwrdSessionObject" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["StwrdSessionObject"] }]
}
```

`index.ts`:

```ts
import { StwrdSessionObject, stwrdFor } from "@stwrd-auth/workers";

// The Durable Object class that wrangler.jsonc binds as STWRD_SESSIONS.
export { StwrdSessionObject };

export default {
  async fetch(request: Request, env: object, ctx: ExecutionContext): Promise<Response> {
    const stwrd = stwrdFor(env);

    // /auth/sign-in, /auth/callback, /auth/sign-out, /auth/session, ...
    const auth = await stwrd.handle(request, ctx);
    if (auth) return auth;

    // Your own routes: the person, or the response that stops the request.
    const guard = await stwrd.requireAuth(request, { ctx });
    if (!guard.ok) return guard.response;
    return Response.json({ user: guard.context.user?.id });
  },
};
```

Three details of the configuration matter:

- The binding must be named `STWRD_SESSIONS` and point to the class `StwrdSessionObject`, which your Worker has to export.
- The migration creates that class with SQLite storage; without it Cloudflare rejects the deploy. Keep the tag `v1`; a future migration gets a new tag.
- Register `{STWRD_BASE_URL}/auth/callback` as a redirect URI of the application in stwrd.

Run `wrangler dev` to try it locally, and `wrangler deploy --dry-run` to check that the Worker bundles and the binding is in place (it needs no Cloudflare account).

## Configuration

Public values go in `wrangler.jsonc` under `vars` or in the dashboard. Everything secret is set with `wrangler secret put` and never in `vars`: a value in `vars` is in your repository and in the dashboard in the clear.

```sh
wrangler secret put STWRD_CLIENT_SECRET
wrangler secret put STWRD_COOKIE_SECRET
wrangler secret put STWRD_SESSION_KEYS
```

| Variable | Required | Secret | Description |
|---|---|---|---|
| `STWRD_ISSUER` | yes | no | Issuer URL of the tenant. |
| `STWRD_CLIENT_ID` | yes | no | OIDC client ID of the application. |
| `STWRD_BASE_URL` | yes | no | Public URL of the Worker, without a trailing slash. |
| `STWRD_CLIENT_SECRET` | yes | yes | Client secret of the application. |
| `STWRD_COOKIE_SECRET` | yes | yes | HMAC key of the session cookie, at least 32 random characters. |
| `STWRD_SESSION_KEYS` | yes | yes | Keys that seal the stored sessions: `id:key` entries separated by commas, each key 32 bytes in base64url. The first entry encrypts; all of them decrypt. |
| `STWRD_WEBHOOK_SECRET` | no | yes | Without it `/auth/webhook` answers 503. |
| `STWRD_SCOPE`, `STWRD_PREFIX`, `STWRD_SESSION_TTL_S`, `STWRD_COOKIE_SECURE`, `STWRD_POST_LOGIN_REDIRECT`, `STWRD_POST_LOGOUT_REDIRECT` | no | no | Optional; defaults and meaning as in [`@stwrd-auth/core`](https://www.npmjs.com/package/@stwrd-auth/core). Add `org` to the scope to enable organizations. |

Create the first session key with:

```sh
node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64url'))"
```

Whoever can read `STWRD_SESSION_KEYS` can read every session; treat it like a password. If any variable is missing or malformed, `stwrdFor` throws a `ConfigError`, so the Worker does not start half configured.

### Rotating keys

- Session keys rotate without signing anyone out. Generate a new key (`k2:...`) and put it first: `STWRD_SESSION_KEYS="k2:<new>,k1:<old>"`. Deploy. After `STWRD_SESSION_TTL_S` seconds (8 hours by default) every session sealed with the old key has expired or has been renewed under the new one; then remove `k1` and deploy again. Removing it earlier makes the people still under `k1` sign in again.
- The cookie secret does not rotate: there is no window for the previous secret, and changing `STWRD_COOKIE_SECRET` signs everybody out.
- Changing `STWRD_ISSUER` or `STWRD_CLIENT_ID` makes the stored sessions unreadable (everybody signs in again), by design: two apps that share a binding never read each other's sessions.

### Options and hooks

`stwrdFor(env, options?)` builds the instance on the first call for an `env` and returns the same instance afterwards. `options` overrides the environment and can add `onUserRegistered(user)` (runs on every successful sign-in), `onEvent(event)` (runs for each accepted webhook delivery), `fetch`, `sessions` and `backChannel`. A later call that changes a value option (`issuer`, `clientId`, `scope`, ...) throws a `ConfigError`, because it would be ignored. Functions are not compared: those of the first call stay and later ones are ignored without error, so passing a hook inline in `fetch(request, env, ctx)` works on every request:

```ts
const stwrd = stwrdFor(env, {
  onUserRegistered: async (user) => {
    console.log("new person", user.id);
  },
});
```

## API reference

### `StwrdWorkers`

| Member | Description |
|---|---|
| `handle(request, ctx?)` | Serves the `/auth/*` routes. Returns `null` for any other path or method, so the rest of your Worker runs as usual. |
| `requireAuth(request, options?)` | Guard: signed in. |
| `requireRole(request, role, options?)` | Guard: the role (organization roles when the session has an organization). |
| `requirePermission(request, permission, options?)` | Guard: the permission. |
| `requireOrg(request, options?)` | Guard: the session has an organization. Needs the `org` scope (`ConfigError` otherwise). |
| `protect(request, { public?, api?, ctx? })` | Fail-closed: `null` lets the request through, a `Response` stops it. Everything needs a session except the listed paths (exact, or a prefix ending in `*`) and everything under the auth prefix. |
| `resolve(request, ctx?)` | The session context for a route that works with or without a person. Check `idpUnavailable` before rendering a "signed out" state. |

Each guard answers `{ ok: true, context }`, with `context.user`, `context.organization`, `context.consents` and `context.session`, or `{ ok: false, response }` with the response that stops the request. In order: identity provider or session store silent gives 503; no person gives a 303 to sign-in for a browser navigation or a 401 JSON (always 401 with `{ api: true }`); a failed rule gives 403. The session is read once per request.

### Other exports

`StwrdSessionObject` (the Durable Object), `DurableObjectSessionStore`, `SESSIONS_BINDING`, `parseSessionKeys`, `Keyring`, `MemoryStore` (tests only), `safeTarget`, `sessionContext`, `sessionResponse`, `hasRole`, `hasPermission`, the errors `ConfigError`, `OidcError`, `IdpUnavailable` and `RefreshUncertain`, and the session types.

### Passing `ctx`

Pass the Worker's `ctx` (`handle(request, ctx)`, `resolve(request, ctx)`, or `{ ctx }` in the options of a guard and of `protect`). It is optional, but without it a person who closes the tab while their session is being renewed can leave that session `uncertain` (see below); with it the renewal runs under `ctx.waitUntil` and finishes anyway. The first call that reads the session in a request is the one whose `ctx` counts. A `ctx` without a `waitUntil` function (typically `env` passed where `ctx` goes) is a `ConfigError`, thrown before the session is read.

## How it differs from the Node SDK

- Sessions live in Durable Objects: one object per session, named after the namespace (`issuer|clientId`) and the local session id. The Worker seals the session (JWE) with `STWRD_SESSION_KEYS`; the object keeps only the envelope and the refresh lease, and never sees a key or a token. The object deletes itself when the session expires.
- A network failure while renewing makes the session `uncertain`. The runtime does not tell "could not connect" from "cut after sending", so a refresh that may have been processed is never repeated. That session answers 503 until the person signs in again. Only an explicit "not now" from the identity provider (503, 408, 425, 429) releases it. Before a renewal the SDK asks the identity provider for its discovery document (5-second timeout), so a provider that is down costs a retry and not a session.
- Changing organization takes two steps (retire the old session, install the new one). If the Worker stops between them the person signs in again; there are never two live sessions.
- Back-channel logout deletes the session in its object and then marks the notice, in that order; if the object does not answer the route answers 503 and the identity provider retries.

## Security

- Tokens never reach the browser: the cookie is HMAC-signed (tamper-evident) and carries only a session identifier. Sessions at rest in the Durable Object are encrypted (JWE `dir` + `A256GCM`) and authenticated against their namespace and id, so a copied envelope is rejected.
- Secrets (`STWRD_CLIENT_SECRET`, `STWRD_COOKIE_SECRET`, `STWRD_SESSION_KEYS`, `STWRD_WEBHOOK_SECRET`) belong in `wrangler secret put`. Error messages name the variable or the position of an entry, never a key.
- Sign-out and the organization switch require a CSRF token; redirect targets are confined to relative paths of the app; requests to the identity provider never follow redirects; the redirect URI is built from `STWRD_BASE_URL`, never from the `Host` header. The protocol details are those of `@stwrd-auth/core`.
- Supported versions and how to report a vulnerability are described in the [security policy](https://github.com/stwrd-dev/sdk-js/security/policy).

## Error handling and troubleshooting

A 503 from `/auth/session` or from a guard means "could not find out", never "signed out". The person keeps their session; show "try again" and not the sign-in page.

| Symptom | Cause | What to do |
|---|---|---|
| 503 that goes away by itself | The identity provider or a Durable Object did not answer. | Nothing; the next request tries again. |
| 503 that stays for one person | The session is `uncertain`: a renewal was cut off after it may have been sent. | The person signs in again; `/auth/sign-in` treats that session as gone. A "Sign in again" button on your 503 page is enough. Pass `ctx` everywhere to make this rare. |
| Many people `uncertain` at once | The identity provider was down during renewals. | Check the Worker logs for 503 answers. |
| `ConfigError` at start | A variable is missing or malformed, the binding is missing, or the compatibility flag or date is wrong. | The message names the cause. |
| The Worker does not start | `nodejs_compat` is missing. | Add the flag and a recent `compatibility_date`. |
| Everybody signed out after a deploy | `STWRD_COOKIE_SECRET`, `STWRD_ISSUER` or `STWRD_CLIENT_ID` changed. | Expected; see "Rotating keys". |

## Compatibility

- Cloudflare Workers with `nodejs_compat`; Durable Objects with SQLite storage.
- Node.js 20 or newer for `wrangler` and the build.
- ESM only; TypeScript declarations included (use `@cloudflare/workers-types` for `ExecutionContext`).
- The test suite runs on workerd, the Workers runtime, and the example above bundles with `wrangler deploy --dry-run`. Behavior on Cloudflare's network itself is not covered by the tests.

## Versioning

This package follows Semantic Versioning (SemVer). While the version is below 1.0, minor releases may contain breaking changes. `@stwrd-auth/core` is pinned to an exact version, so the two always move together. Changes are listed in `CHANGELOG.md`.

## License

MIT © 2026 stwrd. See `LICENSE`.
