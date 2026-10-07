import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StwrdProvider, Protect, useSession, useUser, useOrganization } from "../../src/index.js";
import { sessionResponse, signedInUser, mockSessionFetch } from "./fixtures.js";
import type { StwrdContextValue } from "../../src/StwrdProvider.js";
let session: StwrdContextValue;
function Probe() {
  session = useSession();
  const user = useUser(), org = useOrganization();
  return <span data-testid="snapshot">{`${session.status}:${user?.id ?? "none"}:${org?.id ?? "none"}:${session.consents.terms ?? "none"}`}</span>;
}
afterEach(() => vi.unstubAllGlobals());
const good = () => sessionResponse({ authenticated: true, user: signedInUser() });
const org = { id: "opaque-org", display_name: "Acme", roles: ["manager"], permissions: ["invite"] };
const malformed: Array<[string, (body: any) => unknown]> = [
  ["missing user", b => { delete b.user; return b; }],
  ["missing profile field", b => { delete b.user.display_name; return b; }],
  ["false with user", b => ({ ...b, authenticated: false })],
  ["true without user", b => ({ ...b, user: null })],
  ["mixed families", b => ({ ...b, user: { ...b.user, roles: ["personal"] }, organization: org })],
  ["partial organization", b => ({ ...b, organization: { id: "o" } })],
  ["bad capability", b => ({ ...b, user: { ...b.user, roles: [3] } })],
  ["bad consent", b => ({ ...b, consents: { terms: "version-1" } })],
  ["legacy user", b => ({ ...b, user: { ...b.user, sub: "legacy" } })],
  ["private token", b => ({ ...b, access_token: "private" })],
  ["anonymous csrf", () => ({ ...sessionResponse(), csrf_token: "csrf" })],
  ["javascript: account_url", b => ({ ...b, account_url: "javascript:alert(1)" })],
  ["data: account_url", b => ({ ...b, account_url: "data:text/html,x" })],
];
for (const [name, mutate] of malformed) it(`rejects ${name} and retains the last snapshot`, async () => {
  const initial = good();
  initial.consents = { terms: "accepted" };
  mockSessionFetch(initial, mutate(good()) as any);
  render(<StwrdProvider><Probe /><Protect fallback="denied">authorized</Protect></StwrdProvider>);
  await waitFor(() => expect(session.status).toBe("authenticated"));
  await act(() => session.refresh());
  expect(session.status).toBe("unavailable");
  expect(session.user).toEqual(initial.user);
  expect(session.consents).toEqual(initial.consents);
  expect(screen.queryByText("authorized")).toBeNull();
  expect(screen.queryByText("denied")).toBeNull();
});
it.each([
  [null, ["manager"], ["invite"], true],
  [org, [], [], true],
  [{ ...org, roles: [], permissions: [] }, [], [], false],
])("selects one capability family (%j)", async (organization, roles, permissions, allowed) => {
  mockSessionFetch(sessionResponse({ authenticated: true, user: signedInUser({ roles, permissions }), organization }));
  render(<StwrdProvider><Probe /><Protect role="manager" permission="invite" fallback="denied">authorized</Protect></StwrdProvider>);
  await waitFor(() => expect(session.status).toBe("authenticated"));
  expect(screen.queryByText(allowed ? "authorized" : "denied")).not.toBeNull();
});
function deferred() {
  let resolve!: (v: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve: (body: unknown) => resolve({ ok: true, json: async () => body } as Response) };
}
it("older refresh cannot restore authority after newer anonymous response", async () => {
  const old = deferred(), latest = deferred();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => good() }).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise));
  render(<StwrdProvider><Probe /></StwrdProvider>);
  await waitFor(() => expect(session.status).toBe("authenticated"));
  let a!: Promise<void>, b!: Promise<void>;
  act(() => { a = session.refresh(); b = session.refresh(); });
  await act(async () => { latest.resolve(sessionResponse()); await b; });
  await act(async () => { old.resolve(good()); await a; });
  expect(session.status).toBe("anonymous");
  expect(session.user).toBeNull();
});
it("sign-out invalidates pending refresh authority and submits CSRF", async () => {
  const old = deferred();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => good() }).mockReturnValueOnce(old.promise));
  render(<StwrdProvider><Probe /><Protect>authorized</Protect></StwrdProvider>);
  await waitFor(() => expect(session.status).toBe("authenticated"));
  let pending!: Promise<void>;
  act(() => { pending = session.refresh(); });
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  act(() => session.signOut());
  await act(async () => { old.resolve(good()); await pending; });
  expect(session.status).toBe("loading");
  expect(screen.queryByText("authorized")).toBeNull();
  expect((submit.mock.instances[0] as HTMLFormElement).querySelector("input")?.value).toBe("csrf");
  submit.mockRestore();
});
it("retained callbacks use the current backend and its CSRF after configuration changes", async () => {
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => sessionResponse({ authenticated: true, user: signedInUser({ id: url.startsWith('/b/') ? 'B' : 'A' }), csrf_token: url.startsWith('/b/') ? 'csrf-B' : 'csrf-A' }) }));
  vi.stubGlobal('fetch', fetchMock);
  const { rerender } = render(<StwrdProvider baseUrl="/a"><Probe /></StwrdProvider>);
  await waitFor(() => expect(session.user?.id).toBe('A'));
  const oldRefresh = session.refresh, oldSignOut = session.signOut;
  rerender(<StwrdProvider baseUrl="/b"><Probe /></StwrdProvider>);
  await waitFor(() => expect(session.user?.id).toBe('B'));
  fetchMock.mockClear();
  await act(() => oldRefresh());
  expect(session.user?.id).toBe('B');
  expect(fetchMock).toHaveBeenCalledWith('/b/session', { credentials: 'include', cache: 'no-store' });
  const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  act(() => oldSignOut());
  const form = submit.mock.instances[0] as HTMLFormElement;
  expect(form.getAttribute('action')).toBe('/b/sign-out');
  expect(form.querySelector('input')?.value).toBe('csrf-B');
  submit.mockRestore();
});
