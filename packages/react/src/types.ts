export type ConsentState = "accepted" | "declined" | "pending";
export interface StwrdUser {
  id: string;
  email: string | null;
  email_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  permissions: string[];
}
export interface StwrdOrganization {
  id: string;
  display_name: string;
  roles: string[];
  permissions: string[];
}
export interface SessionResponse {
  authenticated: boolean;
  user: StwrdUser | null;
  organization: StwrdOrganization | null;
  consents: Record<string, ConsentState>;
  csrf_token: string | null;
  account_url: string;
}
interface Snapshot {
  user: StwrdUser | null;
  organization: StwrdOrganization | null;
  consents: Record<string, ConsentState>;
  accountUrl: string;
}
export type StwrdState =
  | (Snapshot & { status: "loading" | "unavailable" })
  | (Snapshot & { status: "authenticated"; user: StwrdUser })
  | (Snapshot & { status: "anonymous"; user: null; organization: null });
/** One of the signed-in person's own organizations, as listed by the BFF. */
export interface OrganizationOption {
  id: string;
  display_name: string | null;
  current: boolean;
}
