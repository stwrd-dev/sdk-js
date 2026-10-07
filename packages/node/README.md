# @stwrd-auth/node

stwrd SDK for Node.js and Express (backend-for-frontend profile): the `/auth/*` routes, server-side sessions, route guards and webhook verification.

## What it is

[stwrd](https://stwrd.dev) is a multi-tenant identity provider. In the backend-for-frontend (BFF) profile the server performs the OpenID Connect flow and keeps the tokens; the browser only holds a signed session cookie. This package mounts the sign-in, callback, sign-out and session routes in an Express app and gives you guards to protect your own routes. It exposes the same routes, the same `GET /auth/session` JSON and the same environment variables as the Python SDK (`stwrd-auth` on PyPI).

Related packages:

- [`@stwrd-auth/core`](https://www.npmjs.com/package/@stwrd-auth/core): the runtime-neutral logic this package builds on (installed automatically).
- [`@stwrd-auth/react`](https://www.npmjs.com/package/@stwrd-auth/react): session hooks and components for the front end.
- [`@stwrd-auth/workers`](https://www.npmjs.com/package/@stwrd-auth/workers): the same SDK for Cloudflare Workers.

## Installation

```sh
npm install @stwrd-auth/node express
```

Requires Node.js 20 or newer. `express` (`^4 || ^5`) is a peer dependency: the package uses the Express your app already has. `pg` (`^8`) is an optional peer dependency, needed only for the PostgreSQL session store. The package is ESM only and ships its own TypeScript declarations.

## Minimal example

Set the environment variables below, then:

```ts
import express from "express";
import { Stwrd, requireAuth, requirePermission, requireRole, safeTarget } from "@stwrd-auth/node";

const stwrd = Stwrd.fromEnv();
const app = express();

app.use(stwrd.attach()); // resolves the session once and leaves it in req.stwrd
app.use(
  stwrd.authRouter({
    onEvent: (event) => console.log("webhook", event.type, event.data),
  }),
);

app.get("/", (req, res) => {
  const user = req.stwrd?.user ?? null;
  if (!user) {
    res.send('<a href="/auth/sign-in?return_to=/private">Sign in</a>');
    return;
  }
  res.send(`<p>Hello, ${user.email}.</p><a href="/private">Private area</a>`);
});

app.get("/private", requireAuth(stwrd), (req, res) => {
  const { user, session } = req.stwrd!;
  // Sign-out is a POST with a CSRF token; this is the one /auth/session hands out.
  const csrf = stwrd.csrf(session!.id);
  res.send(
    `<p>Welcome, ${user!.email}. Your id is ${user!.id}.</p>` +
      '<form method="post" action="/auth/sign-out">' +
      `<input type="hidden" name="csrf_token" value="${csrf}"><button>Sign out</button></form>`,
  );
});

app.get("/admin", requireRole(stwrd, "org:admin"), (req, res) => {
  res.json({ org: req.stwrd!.organization!.display_name, roles: req.stwrd!.organization!.roles });
});

app.post("/invitations", requirePermission(stwrd, "members:invite"), (req, res) => {
  res.json({ invited_by: req.stwrd!.user!.id });
});

// A redirect target that came from a query parameter goes through safeTarget:
// only relative paths of this app are accepted, anything else falls back.
app.get("/go", (req, res) => {
  res.redirect(303, safeTarget(String(req.query.to ?? ""), "/"));
});

app.listen(Number(process.env.PORT ?? 3000));
```

Register `{STWRD_BASE_URL}/auth/callback` as a redirect URI of the application in stwrd.

`authRouter` reads its own request bodies (forms for sign-out and back-channel logout, JSON for the organization switch, the raw bytes for the webhook), so you do not need `express.json()` before it. If your app mounts a body parser globally before the router, sign-out, back-channel logout and the organization switch still work, but the webhook signature cannot be verified: it is computed over the exact bytes received, so the route answers 400 `invalid_signature`. Mount the parser after the router, or give the webhook path `express.raw()`.

## Configuration

`Stwrd.fromEnv(env = process.env, overrides = {})` reads these variables; `createStwrd(options)` takes the same values as camelCase options. A missing required variable, or a cookie secret shorter than 32 characters, throws `ConfigError` at construction.

| Variable | Required | Default | Description |
|---|---|---|---|
| `STWRD_ISSUER` | yes | | Issuer URL of the tenant. |
| `STWRD_CLIENT_ID` | yes | | OIDC client ID of the application. |
| `STWRD_CLIENT_SECRET` | yes | | Client secret of the application. |
| `STWRD_BASE_URL` | yes | | Public URL of the app. `{baseUrl}/auth/callback` is the redirect URI. |
| `STWRD_COOKIE_SECRET` | yes | | HMAC key of the session cookie, at least 32 characters. |
| `STWRD_SCOPE` | no | `openid profile email offline_access` | Requested scopes (see Scopes). |
| `STWRD_WEBHOOK_SECRET` | no | none | Without it `/auth/webhook` answers 503. |
| `STWRD_PREFIX` | no | `/auth` | Path prefix of the routes. |
| `STWRD_SESSION_TTL_S` | no | `28800` | Sliding session lifetime in seconds. |
| `STWRD_COOKIE_SECURE` | no | `true` | `Secure` attribute of the cookies. |
| `STWRD_POST_LOGIN_REDIRECT` | no | `/` | Destination when a sign-in has no `return_to`. |
| `STWRD_POST_LOGOUT_REDIRECT` | no | `/` | Destination after sign-out. |

The remaining options (cookie names, transaction lifetime, `sessions`, `fetch`) are documented in [`@stwrd-auth/core`](https://www.npmjs.com/package/@stwrd-auth/core). `STWRD_COOKIE_SECURE=false` is for local development over plain HTTP only; browsers reject `__Host-` cookies that are not `Secure`, so also set the `sessionCookie` and `txCookie` options to names without that prefix.

### Scopes

The default scope does not include `org`; without it `organization` is `null`. Add `org` to `STWRD_SCOPE` (`openid profile email offline_access org`) to receive organization roles and permissions, and allow that scope for the application in stwrd: requesting a scope the application is not allowed makes the authorize request fail with `invalid_scope`. Individual roles and permissions are in `user.roles` and `user.permissions`; with an organization they are in `organization.roles` and `organization.permissions`.

## API reference

### Entry points

| Import | Contents |
|---|---|
| `@stwrd-auth/node` | `Stwrd`, `createStwrd`, guards, `safeTarget`, session helpers, webhook helpers, configuration and OIDC primitives, `makeHostFetch` |
| `@stwrd-auth/node/management` | `createManagement`: typed Management API client |
| `@stwrd-auth/node/webhooks` | `verifyWebhook`, `signWebhook`, `SeenEventIds` and related errors |
| `@stwrd-auth/node/postgres` | `PostgresSessionStore`, `SCHEMA_SQL`, `Keyring` |

### `Stwrd`

| Member | Description |
|---|---|
| `Stwrd.fromEnv(env?, overrides?)` / `createStwrd(options)` | Build the instance once and share it. |
| `stwrd.attach()` | Middleware that resolves the session once per request and leaves `{ user, organization, consents, session }` in `req.stwrd`. |
| `stwrd.authRouter({ onUserRegistered?, onEvent? })` | Express router for the `/auth/*` routes. `onUserRegistered(user)` runs on every successful sign-in, not only the first; `onEvent(event)` runs for each accepted webhook delivery, after deduplication. |
| `stwrd.protectAll({ public })` | Opt-in fail-closed middleware: every path needs a session unless it is listed. Paths under the auth prefix are always public; `*` is a wildcard only at the end of an entry. |
| `stwrd.csrf(sessionId)` | The CSRF token of a session. |
| `stwrd.sessionFromRequest(req)`, `stwrd.resolveSessionFromRequest(req)` | Read a session outside the middleware; the second one renews expired tokens. |

### Guards

Each guard is a factory that takes the `Stwrd` instance and returns an Express `RequestHandler`.

| Guard | If the requirement is not met |
|---|---|
| `requireAuth(stwrd)` | 303 to sign-in for a browser navigation, otherwise 401 `{"detail":"No session."}` |
| `requireRole(stwrd, role)` | 403 `{"detail":"Missing role org:admin."}` |
| `requirePermission(stwrd, permission)` | 403 `{"detail":"Missing permission members:invite."}` |
| `requireOrg(stwrd)` | 403 `{"detail":"The session has no organization."}`; throws `ConfigError` at creation if the `org` scope is not requested |
| `apiMode()` | Forces the 401 JSON instead of the 303 on this route |

Roles and permissions are checked by membership against the organization when the session has one, otherwise against the individual lists.

### Session JSON

`GET /auth/session` answers `authenticated`, `user`, `organization`, `consents`, `csrf_token` and `account_url`. The profile has `id`, `display_name` and `avatar_url`; tokens, the identity provider's `sid` and the raw claims stay on the server. An anonymous answer has `user: null`, `organization: null`, `consents: {}` and `csrf_token: null`. `sessionContext(session)` produces the same context, and `hasRole(context, role)` and `hasPermission(context, permission)` check it.

### Webhooks

`/auth/webhook` verifies the signature and deduplicates by event `id` (30 hours, in memory). To verify by hand, in another route or framework:

```ts
import { verifyWebhook, SeenEventIds } from "@stwrd-auth/node/webhooks";

const seen = new SeenEventIds();
// rawBody: string | Buffer with the exact bytes received; headers: the request headers.
const event = verifyWebhook(rawBody, headers, process.env.STWRD_WEBHOOK_SECRET!, { seen });
```

Deliveries carry `webhook-id`, `webhook-timestamp` and `webhook-signature` (`v1,` followed by the base64 HMAC-SHA256 of `id.timestamp.body`), with a 300-second tolerance. `signWebhook(secret, { eventId, timestamp, body })` produces the same signature for tests.

### Management API

```ts
import { createManagement } from "@stwrd-auth/node/management";

const api = createManagement({
  issuer: process.env.STWRD_ISSUER!,
  clientId: process.env.STWRD_MANAGEMENT_CLIENT_ID!,
  clientSecret: process.env.STWRD_MANAGEMENT_CLIENT_SECRET!,
  scopes: ["mgmt:users:read", "mgmt:users:write"],
});

const observed = await api.users.get({ path: { user_id: userId } });
await api.users.update({ path: { user_id: userId }, body: { name: "Ada" }, options: { ifMatch: observed.etag ?? undefined } });
for await (const user of api.users.iterate()) console.log(user.id);
```

Server-side only. Operations, request bodies and responses are typed. Writes are never retried automatically; errors are `ManagementError` with `status`, `body` and `requestId`.

### Sessions across several processes

`MemoryStore` (the default) keeps sessions in one process. With several processes, use the PostgreSQL store so that a refresh token is exchanged at most once and a sign-out is seen everywhere. Create the table with your own migration (`SCHEMA_SQL`; the store never creates tables), then:

```ts
import pg from "pg";
import { Keyring, PostgresSessionStore } from "@stwrd-auth/node/postgres";

const store = new PostgresSessionStore(new pg.Pool({ connectionString }), {
  namespace: `${tenantId}/${clientId}`,
  keyring: new Keyring({ "2026-10": keyBytes }, "2026-10"),
});
const stwrd = createStwrd({ ...options, sessions: store });
```

Sessions are encrypted (JWE) with the keyring, which is independent of the cookie secret, and are bound to their namespace and id. To rotate a key, deploy the new key to every process as a non-current key, switch `current`, and remove the old key only after `store.purgeExpired()` (run it periodically) has removed every session written under it. Lease expiry is judged by the database clock. Any other store can implement the `SessionStore` interface.

### Developing against a local identity provider

The identity provider resolves the tenant from the `Host` header, and Node's global `fetch` replaces that header with the destination's. `makeHostFetch` connects to a fixed address and sends the issuer's `Host` as is:

```ts
import { Stwrd, makeHostFetch } from "@stwrd-auth/node";

const stwrd = Stwrd.fromEnv(process.env, {
  fetch: makeHostFetch({ connectHost: "127.0.0.1", connectPort: 3005, host: "idp.example.com" }),
});
```

## Security

- The browser holds a single signed cookie (`__Host-stwrd_session`: HMAC-signed, `HttpOnly`, `SameSite=Lax`, `Secure` unless disabled). Access, ID and refresh tokens never leave the server. The signature makes the cookie tamper-evident; it is not encrypted.
- Sign-out and the organization switch require a CSRF token (`x-csrf-token` header or `csrf_token` form field). Redirect targets taken from requests are confined to relative paths of the app (`safeTarget`).
- Authorization uses PKCE, `state` and `nonce`; ID tokens are verified for signature, issuer, audience, expiry, `nonce` and `at_hash`. Requests to the identity provider never follow redirects, and the redirect URI is built from `STWRD_BASE_URL`, never from the `Host` header.
- Webhook signatures are compared in constant time. The in-memory deduplication is a convenience; a receiver that needs a hard guarantee also deduplicates by event `id` in its own storage.
- Keep `STWRD_COOKIE_SECRET`, `STWRD_CLIENT_SECRET`, `STWRD_WEBHOOK_SECRET` and the session keyring out of source control and logs. Changing the cookie secret signs everyone out.
- Supported versions and how to report a vulnerability are described in the [security policy](https://github.com/stwrd-dev/sdk-js/security/policy).

## Error handling and troubleshooting

| Situation | Answer |
|---|---|
| Navigation without a session | 303 to `{prefix}/sign-in?return_to=...` |
| API call without a session | 401 `{"detail":"No session."}` |
| Missing role, permission, organization or CSRF token | 403 with `detail` |
| The identity provider does not answer | 503 `The IdP did not respond.` (`Cache-Control: no-store` on `/auth/session`) |
| Rejected sign-in callback | 400, plain text |
| `/auth/webhook` | 200 `{"status":"ok"}` or `{"status":"duplicate"}`; 400 `{"error":"invalid_signature"}`; 503 `{"error":"webhook_not_configured"}` |
| Request body above the limit | 413 |

A 503 never means the person signed out: the session is kept and the next request tries again. A session that stays on 503 for one person is `uncertain` (a token renewal may have been processed without its result being stored); signing in again fixes it. The classes `ConfigError`, `OidcError`, `IdpUnavailable` and `RefreshUncertain` are exported for your own handling.

## Compatibility

- Node.js 20 or newer; Express 4 (the version the test suite runs against) and 5 (declared in the peer range).
- ESM only. TypeScript declarations are included and resolve under `node10`, `nodenext` and `bundler` module resolution.
- PostgreSQL store: `pg` 8.

## Versioning

This package follows Semantic Versioning (SemVer). While the version is below 1.0, minor releases may contain breaking changes. `@stwrd-auth/core` is pinned to an exact version, so the two always move together. Changes are listed in `CHANGELOG.md`.

## License

MIT © 2026 stwrd. See `LICENSE`.
