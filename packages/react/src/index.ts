/**
 * `@stwrd-auth/react` — the React SDK, BFF mode: the provider, the session
 * hooks and the guard and account components.
 */

export { StwrdProvider } from "./StwrdProvider.js";
export type { StwrdProviderProps } from "./StwrdProvider.js";

export { useSession, useUser, useOrganization } from "./useSession.js";

export { OrganizationSwitcher, Protect, SignedIn, SignedOut, UserButton } from "./components.js";
export type {
  OrganizationSwitcherProps,
  ProtectProps,
  SignedInProps,
  SignedOutProps,
  UserButtonProps,
} from "./components.js";

export type { ConsentState, OrganizationOption, SessionResponse, StwrdState, StwrdUser, StwrdOrganization } from "./types.js";
