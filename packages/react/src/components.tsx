import { useEffect, useState, type ReactElement, type ReactNode } from "react";

import { useSession } from "./useSession.js";
import type { OrganizationOption, StwrdUser } from "./types.js";

export interface SignedInProps {
  children?: ReactNode;
}

export function SignedIn({ children }: SignedInProps): ReactElement | null {
  const { status } = useSession();
  if (status !== "authenticated") {
    return null;
  }
  return <>{children}</>;
}

export interface SignedOutProps {
  children?: ReactNode;
}

export function SignedOut({ children }: SignedOutProps): ReactElement | null {
  const { status } = useSession();
  if (status !== "anonymous") {
    return null;
  }
  return <>{children}</>;
}

export interface ProtectProps {
  role?: string;
  permission?: string;

  condition?: (user: StwrdUser) => boolean;

  fallback?: ReactNode;
  children?: ReactNode;
}

export function Protect({ role, permission, condition, fallback = null, children }: ProtectProps): ReactElement | null {
  const { user, organization, status } = useSession();
  if (status === "loading" || status === "unavailable") {
    // `unavailable` is handled with `loading`, not with `user === null`: the
    // `fallback` is what a person WITHOUT permission sees, and whether this
    // person has it is not known.
    return null;
  }
  if (user === null) {
    return <>{fallback}</>;
  }
  const capabilities = organization ?? user;
  if ((role !== undefined && !capabilities.roles.includes(role)) || (permission !== undefined && !capabilities.permissions.includes(permission)) || (condition && !condition(user))) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

export interface UserButtonProps {
  className?: string;
}

export function UserButton({ className }: UserButtonProps): ReactElement | null {
  const { user, accountUrl, signOut, status } = useSession();
  if (status !== "authenticated") {
    return null;
  }
  const label = user.display_name ?? user.email ?? user.id;
  return (
    <div className={className} data-stwrd="user-button">
      <span data-stwrd="user-button-label">{label}</span>
      <a href={accountUrl} data-stwrd="user-button-account-link">
        Account
      </a>
      <button type="button" onClick={signOut} data-stwrd="user-button-sign-out">
        Sign out
      </button>
    </div>
  );
}

/** Two organizations can share a display name; the id tells them apart. */
function optionLabel(option: OrganizationOption, all: OrganizationOption[]): string {
  const name = option.display_name ?? option.id;
  const repeated = all.filter(other => (other.display_name ?? other.id) === name).length > 1;
  return repeated && option.display_name !== null ? `${name} (${option.id.slice(0, 8)})` : name;
}

export interface OrganizationSwitcherProps {
  className?: string;
}

export function OrganizationSwitcher({
  className,
}: OrganizationSwitcherProps): ReactElement | null {
  const { organization, accountUrl, status, user, listOrganizations, selectOrganization } = useSession();
  const [options, setOptions] = useState<OrganizationOption[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const signedIn = status === "authenticated" && organization !== null;
  const identity = signedIn ? `${user?.id}:${organization?.id}` : null;
  useEffect(() => {
    // A late answer for a previous identity or status is dropped; losing
    // authority (503) or the session clears the list.
    setOptions(null);
    setPending(null);
    if (identity === null) return;
    let current = true;
    listOrganizations().then(list => { if (current) setOptions(list); }, () => { if (current) setOptions(null); });
    return () => { current = false; };
  }, [identity, listOrganizations]);
  if (!signedIn || organization === null) {
    return null;
  }
  if (options !== null && options.length > 1) {
    // Choosing and confirming are two acts: a key press on a closed <select>
    // fires `change` at once, and the navigation would drop unsaved work.
    const chosen = pending ?? organization.id;
    return (
      <span className={className} data-stwrd="organization-switcher">
        <select
          aria-label="Organization"
          data-stwrd="organization-switcher-select"
          onChange={event => setPending(event.target.value)}
          value={options.some(option => option.id === chosen) ? chosen : ""}
        >
          {options.every(option => option.id !== organization.id) && <option disabled value="">{organization.display_name}</option>}
          {options.map(option => <option key={option.id} value={option.id}>{optionLabel(option, options)}</option>)}
        </select>
        <button
          type="button"
          data-stwrd="organization-switcher-confirm"
          disabled={pending === null || pending === organization.id}
          onClick={() => { if (pending !== null && pending !== organization.id) selectOrganization(pending); }}
        >
          Switch
        </button>
      </span>
    );
  }
  return (
    <a
      className={className}
      data-stwrd="organization-switcher"
      href={`${accountUrl}/organizations`}
    >
      {organization.display_name}
    </a>
  );
}
