import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { OrganizationOption, SessionResponse, StwrdState } from "./types.js";
export type StwrdContextValue = StwrdState & {
  refresh(): Promise<void>;
  signOut(): void;
  /** The person's own organizations; `null` when organization selection is not enabled on the BFF. */
  listOrganizations(): Promise<OrganizationOption[] | null>;
  /** Starts a real OIDC navigation for the chosen organization; the page leaves. */
  selectOrganization(id: string): void;
};
const Context = createContext<StwrdContextValue | null>(null);
export interface StwrdProviderProps { baseUrl?: string; children?: ReactNode }
const empty = (): StwrdState => ({ status: "loading", user: null, organization: null, consents: {}, accountUrl: "" });
const backoff = [2000, 4000, 8000];
// Other tabs only ever receive "something changed, ask again": never tokens or claims.
const CHANNEL = "stwrd:session";
const CHANGED_FLAG = "stwrd:session-changed";
function organizationOptions(v: unknown): OrganizationOption[] | null {
  if (!record(v) || !Array.isArray(v.organizations)) return null;
  const list = v.organizations as unknown[];
  return list.every(o => record(o) && keys(o, ["id", "display_name", "current"]) && nonempty(o.id) && nullableString(o.display_name) && typeof o.current === "boolean") ? (list as OrganizationOption[]) : null;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const nullableString = (v: unknown) => v === null || typeof v === "string";
/** A rendered `href` must never carry a `javascript:` (or any non-web) scheme. */
const webUrl = (v: unknown) => { if (!nonempty(v)) return false; try { const p = new URL(v as string, "https://placeholder.invalid").protocol; return p === "https:" || p === "http:"; } catch { return false; } };
const nonempty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
/** Reject incomplete, legacy and contradictory browser responses before publishing authority. */
function valid(v: unknown): v is SessionResponse {
  if (!record(v) || !keys(v, ["authenticated", "user", "organization", "consents", "csrf_token", "account_url"]) || typeof v.authenticated !== "boolean" || !webUrl(v.account_url) || !record(v.consents) || !Object.values(v.consents).every(x => x === "accepted" || x === "declined" || x === "pending")) return false;
  if (!v.authenticated) return v.user === null && v.organization === null && v.csrf_token === null && Object.keys(v.consents).length === 0;
  const u = v.user, o = v.organization;
  if (!record(u) || !keys(u, ["id", "email", "email_verified", "display_name", "avatar_url", "roles", "permissions"]) || !nonempty(u.id) || !nullableString(u.email) || typeof u.email_verified !== "boolean" || !nullableString(u.display_name) || !nullableString(u.avatar_url) || !strings(u.roles) || !strings(u.permissions) || !nonempty(v.csrf_token)) return false;
  return o === null || (record(o) && keys(o, ["id", "display_name", "roles", "permissions"]) && nonempty(o.id) && nonempty(o.display_name) && strings(o.roles) && strings(o.permissions) && u.roles.length === 0 && u.permissions.length === 0);
}
export function StwrdProvider({ baseUrl = "/auth", children }: StwrdProviderProps) {
  const [state, setState] = useState<StwrdState>(empty);
  const csrf = useRef<string | null>(null);
  // Stable callbacks always target the committed configuration, including retained references.
  const currentBaseUrl = useRef(baseUrl);
  const generation = useRef(0);
  const signingOut = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const refresh = useCallback(async () => {
    if (signingOut.current) return;
    const request = ++generation.current;
    try {
      const response = await fetch(`${currentBaseUrl.current}/session`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Session unavailable");
      const body: unknown = await response.json();
      if (!valid(body)) throw new Error("Invalid session response");
      if (request !== generation.current) return;
      csrf.current = body.csrf_token;
      const snapshot = { user: body.user, organization: body.organization, consents: body.consents, accountUrl: body.account_url };
      setState(body.authenticated ? { ...snapshot, status: "authenticated", user: body.user! } : { ...snapshot, status: "anonymous", user: null, organization: null });
    } catch {
      if (request === generation.current) setState(previous => ({ ...previous, status: "unavailable" }));
    }
  }, []);
  useEffect(() => {
    currentBaseUrl.current = baseUrl;
    signingOut.current = false;
    csrf.current = null;
    setState(empty());
    setAttempt(0);
    void refresh();
    return () => { ++generation.current; };
  }, [baseUrl, refresh]);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bus = new BroadcastChannel(CHANNEL);
    channel.current = bus;
    bus.onmessage = () => { void refresh(); };
    try {
      // A navigation that changed the session (organization switch, sign-out) set this flag
      // before leaving; the page it lands on tells the other tabs once.
      if (sessionStorage.getItem(CHANGED_FLAG)) { sessionStorage.removeItem(CHANGED_FLAG); bus.postMessage("changed"); }
    } catch { /* storage unavailable: other tabs refresh on their own schedule */ }
    return () => { bus.close(); channel.current = null; };
  }, [refresh]);
  useEffect(() => {
    // The only other signal is the BroadcastChannel notice, which a hidden, frozen or
    // restored tab can miss: ask again whenever the tab becomes visible or comes back
    // from the back/forward cache.
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("pageshow", onPageShow); };
  }, [refresh]);
  useEffect(() => {
    if (state.status !== "unavailable") { setAttempt(0); return; }
    if (attempt >= backoff.length || signingOut.current) return;
    const timer = setTimeout(() => { setAttempt(n => n + 1); void refresh(); }, backoff[attempt]);
    return () => clearTimeout(timer);
  }, [state.status, attempt, refresh]);
  const markChanged = () => { try { sessionStorage.setItem(CHANGED_FLAG, "1"); } catch { /* optional */ } };
  const post = (action: string, fields: Record<string, string>) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${currentBaseUrl.current}/${action}`;
    form.style.display = "none";
    for (const [name, value] of Object.entries(fields)) {
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = name;
      field.value = value;
      form.appendChild(field);
    }
    document.body.appendChild(form);
    // A real navigation follows the BFF/IdP redirect chain; fetch would not.
    form.submit();
  };
  const listOrganizations = useCallback(async (): Promise<OrganizationOption[] | null> => {
    const response = await fetch(`${currentBaseUrl.current}/organizations`, { credentials: "include", cache: "no-store" });
    if (response.status === 404) return null;
    // The session ended after `/session` was read: show the truth, not a stale "signed in".
    if (response.status === 401) { void refresh(); return null; }
    if (!response.ok) throw new Error("Organizations unavailable");
    const options = organizationOptions(await response.json());
    if (options === null) throw new Error("Invalid organizations response");
    return options;
  }, [refresh]);
  const selectOrganization = useCallback((id: string) => {
    if (signingOut.current || !csrf.current) return;
    markChanged();
    post("organization", { csrf_token: csrf.current, organization_id: id, return_to: `${window.location.pathname}${window.location.search}` });
  }, []);
  const signOut = useCallback(() => {
    signingOut.current = true;
    ++generation.current;
    setState(previous => ({ ...previous, status: "loading" }));
    markChanged();
    post("sign-out", { csrf_token: csrf.current ?? "" });
  }, []);
  return <Context.Provider value={{ ...state, refresh, signOut, listOrganizations, selectOrganization }}>{children}</Context.Provider>;
}
export function useSessionContext(): StwrdContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useSession() (or a stwrd component) was used outside <StwrdProvider>.");
  return value;
}
