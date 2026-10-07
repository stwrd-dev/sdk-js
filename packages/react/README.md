# @stwrd-auth/react

stwrd SDK for React (backend-for-frontend profile): a session provider, hooks and components that read the session from the `/auth/session` endpoint of your server.

## What it is

[stwrd](https://stwrd.dev) is a multi-tenant identity provider. In the backend-for-frontend (BFF) profile your server performs the OpenID Connect flow and keeps the tokens; the browser only holds a session cookie. This package is the front-end half: it asks your server who is signed in and exposes that to React components. It never sees a token.

It needs a server that serves the `/auth/*` routes on the same origin as your front end: [`@stwrd-auth/node`](https://www.npmjs.com/package/@stwrd-auth/node) (Express), [`@stwrd-auth/workers`](https://www.npmjs.com/package/@stwrd-auth/workers) (Cloudflare Workers) or the Python SDK (`stwrd-auth` on PyPI). Authorization decisions stay on the server; the guards in this package only decide what to render.

## Installation

```sh
npm install @stwrd-auth/react
```

Requires React 18 or newer (peer dependency) and a bundler that understands ESM. The package is ESM only and ships its own TypeScript declarations (install `@types/react` for TypeScript projects).

## Minimal example

```tsx
import {
  OrganizationSwitcher,
  Protect,
  SignedIn,
  SignedOut,
  StwrdProvider,
  UserButton,
  useSession,
} from "@stwrd-auth/react";

export function Home() {
  const session = useSession();
  if (session.status === "loading") return null;
  if (session.status === "unavailable") return <p>Service unavailable.</p>;
  return (
    <>
      <SignedOut>
        <a href="/auth/sign-in?return_to=/">Sign in</a>
      </SignedOut>
      <SignedIn>
        <p>Hello, {session.user?.display_name ?? session.user?.email}.</p>
        <UserButton />
        <OrganizationSwitcher /> {/* lists the person's organizations (needs the `org` scope) */}
        <Protect role="org:admin" permission="members:invite" fallback={<p>No permission.</p>}>
          <a href="/members">Members</a>
        </Protect>
      </SignedIn>
    </>
  );
}

export function App() {
  return (
    <StwrdProvider baseUrl="/auth">
      <Home />
    </StwrdProvider>
  );
}
```

Mount `App` as usual (`createRoot(document.getElementById("root")!).render(<App />)`). During development, proxy `/auth` to your server so that the cookie stays on one origin.

## Configuration

`StwrdProvider` takes one option:

| Prop | Required | Default | Description |
|---|---|---|---|
| `baseUrl` | no | `/auth` | Where the server serves the routes; it must match the server's route prefix (`STWRD_PREFIX`). Changing it resets the session state. |

The components render fixed English labels and expose `data-stwrd` attributes (`user-button`, `user-button-label`, `user-button-account-link`, `user-button-sign-out`, `organization-switcher`, `organization-switcher-select`, `organization-switcher-confirm`) as styling hooks. The `className` prop applies to the outer element.

## API reference

### Provider and hooks

| Export | Description |
|---|---|
| `StwrdProvider` | Reads `GET {baseUrl}/session` with credentials, keeps the state and shares it with the tree. Other tabs are told to refresh when the session changes. |
| `useSession()` | `{ status, user, organization, consents, accountUrl, refresh, signOut, listOrganizations, selectOrganization }` |
| `useUser()` | The signed-in person, or `null`. |
| `useOrganization()` | The active organization, or `null`. |

`status` is one of:

| Status | Meaning |
|---|---|
| `loading` | The first answer has not arrived. |
| `authenticated` | A person is signed in. |
| `anonymous` | Nobody is signed in. |
| `unavailable` | The server could not answer, or answered something invalid. The last known state is kept. The provider retries three times with growing delays (2, 4 and 8 seconds). |

While `unavailable`, `useUser()` and `useOrganization()` may still return the last known values; check `status` before using them for access decisions. `refresh()` asks the server again. `signOut()` navigates with a `POST` form to `{baseUrl}/sign-out`, including the CSRF token the server provided. `listOrganizations()` resolves to the person's organizations, or `null` when the server has organization selection disabled. `selectOrganization(id)` starts a real navigation through the server to switch the active organization.

### Components

| Component | Description |
|---|---|
| `SignedIn`, `SignedOut` | Render their children only when `status` is `authenticated` or `anonymous`. |
| `Protect` | Renders its children when the person has every control given (`role`, `permission`, `condition(user)`); otherwise `fallback`. Capabilities come from the organization when there is one, otherwise from the individual lists. Renders nothing while `loading` or `unavailable`. |
| `UserButton` | The person's name (or email, or id), a link to the account page and a sign-out button. |
| `OrganizationSwitcher` | A selector with a confirm button when the person has several organizations; otherwise a link to the account page of the organization. |

### Types

`StwrdUser` (`id`, `email`, `email_verified`, `display_name`, `avatar_url`, `roles`, `permissions`), `StwrdOrganization` (`id`, `display_name`, `roles`, `permissions`), `SessionResponse`, `StwrdState`, `ConsentState` and `OrganizationOption`. `consents` is a map of consent names to `accepted`, `declined` or `pending`. `accountUrl` is the address of the person's account page.

## Security

- No token, claim or secret reaches the browser through this package. The session cookie is set by your server; the provider only sends `credentials: "include"` requests to `{baseUrl}/session` and `{baseUrl}/organizations`.
- The provider accepts only a response with the exact expected shape and refuses anything else (status `unavailable`), including an `account_url` that is not an `http` or `https` URL.
- Sign-out and the organization switch are `POST` navigations that include the CSRF token issued by the server.
- The guards (`SignedIn`, `Protect`, ...) only change what is rendered. Enforce authorization on the server.
- Components never show session content or the `Protect` fallback while the state is `loading` or `unavailable`.
- Supported versions and how to report a vulnerability are described in the [security policy](https://github.com/stwrd-dev/sdk-js/security/policy).

## Error handling and troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| `status` stays `unavailable` | The server answered with an error, malformed JSON or a response that does not match the expected shape. | Check that `baseUrl` is the route prefix of your server and that `GET {baseUrl}/session` answers 200 JSON with `authenticated`, `user`, `organization`, `consents`, `csrf_token` and `account_url`. |
| `status` is `anonymous` after sign-in | The cookie is not sent: different origin, or a development proxy missing. | Serve the front end and the routes from one origin. |
| `OrganizationSwitcher` shows a link, not a selector | The person has one organization, or organization selection is not enabled. | Add `org` to the server scope (`STWRD_SCOPE`) and allow it for the application. |
| `useSession() ... was used outside <StwrdProvider>` | A hook or component is rendered outside the provider. | Wrap the tree in `StwrdProvider`. |

## Compatibility

- React 18 or newer (the test suite runs against React 18).
- ESM only; TypeScript declarations included.
- Browsers that support `fetch`. `BroadcastChannel` is used for cross-tab updates when available.
- Server side: a BFF that serves `GET /auth/session` in the documented shape. There is no Next.js adapter yet.

## Versioning

This package follows Semantic Versioning (SemVer). While the version is below 1.0, minor releases may contain breaking changes. Changes are listed in `CHANGELOG.md`.

## License

MIT © 2026 stwrd. See `LICENSE`.
