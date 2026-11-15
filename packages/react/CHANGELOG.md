# Changelog

All notable changes to this package are documented in this file.

The format is based on Keep a Changelog 1.1.0, and this package adheres to Semantic Versioning (SemVer).
## [0.1.2]

0.1.2 — first release published from CI with npm trusted publishing (provenance); no code changes.


## [0.1.0] - Unreleased

Initial release.

### Added

- `StwrdProvider` and the `useSession`, `useUser` and `useOrganization` hooks, reading the session from `GET /auth/session`.
- Session status `loading`, `authenticated`, `anonymous` and `unavailable`, with retries and cross-tab refresh.
- Guard components: `SignedIn`, `SignedOut` and `Protect`.
- Account components: `UserButton` and `OrganizationSwitcher`.
- Types: `StwrdUser`, `StwrdOrganization`, `SessionResponse`, `StwrdState`, `ConsentState` and `OrganizationOption`.
