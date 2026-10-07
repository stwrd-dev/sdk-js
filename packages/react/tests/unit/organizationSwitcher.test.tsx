import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StwrdProvider } from "../../src/StwrdProvider.js";
import { OrganizationSwitcher } from "../../src/components.js";
import { LoadingProbe, sessionResponse, signedInUser } from "./fixtures.js";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const inOrg = (id = ORG_A, name = "Org A") =>
  sessionResponse({ authenticated: true, user: signedInUser(), organization: { id, display_name: name, roles: [], permissions: [] } });
const listing = (organizations: unknown) => ({ organizations });
const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function stubFetch(handlers: { session: () => Response; organizations: () => Response }) {
  const mock = vi.fn(async (url: string) => (String(url).endsWith("/organizations") ? handlers.organizations() : handlers.session()));
  vi.stubGlobal("fetch", mock);
  return mock;
}
const settled = () => waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
const mount = () => render(<StwrdProvider><LoadingProbe /><OrganizationSwitcher className="sw" /></StwrdProvider>);

let submitted: Array<{ action: string; fields: Record<string, string> }>;
beforeEach(() => {
  submitted = [];
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
    submitted.push({ action: this.action, fields: Object.fromEntries(new FormData(this) as unknown as Iterable<[string, string]>) });
  });
  sessionStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("integrated OrganizationSwitcher", () => {
  it("lists the person's organizations and selects one through a real form navigation", async () => {
    stubFetch({
      session: () => response(200, inOrg()),
      organizations: () => response(200, listing([{ id: ORG_A, display_name: "Org A", current: true }, { id: ORG_B, display_name: null, current: false }])),
    });
    mount();
    await settled();
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    expect(select.value).toBe(ORG_A);
    expect([...select.options].map(option => option.textContent)).toEqual(["Org A", ORG_B]);
    const confirm = screen.getByRole("button", { name: "Switch" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(select, { target: { value: ORG_B } });
    // Choosing is not confirming: a key press on the closed <select> must not navigate.
    expect(submitted).toHaveLength(0);
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(submitted).toHaveLength(1);
    expect(submitted[0].action).toMatch(/\/auth\/organization$/);
    expect(submitted[0].fields).toEqual({ csrf_token: "csrf", organization_id: ORG_B, return_to: "/" });
    expect(sessionStorage.getItem("stwrd:session-changed")).toBe("1");
  });

  it("choosing the current organization starts nothing", async () => {
    stubFetch({ session: () => response(200, inOrg()), organizations: () => response(200, listing([{ id: ORG_A, display_name: "Org A", current: true }, { id: ORG_B, display_name: "Org B", current: false }])) });
    mount();
    await settled();
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: ORG_A } });
    expect((screen.getByRole("button", { name: "Switch" }) as HTMLButtonElement).disabled).toBe(true);
    expect(submitted).toHaveLength(0);
  });

  it("tells apart two organizations that share a display name", async () => {
    stubFetch({
      session: () => response(200, inOrg()),
      organizations: () => response(200, listing([{ id: ORG_A, display_name: "Org A", current: true }, { id: ORG_B, display_name: "Org A", current: false }])),
    });
    mount();
    await settled();
    const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
    const labels = [...select.options].map(option => option.textContent);
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toContain(ORG_A.slice(0, 8));
  });

  it("a 401 on the list refreshes the session instead of keeping a stale signed-in state", async () => {
    let expired = false;
    stubFetch({
      session: () => (expired ? response(200, sessionResponse()) : response(200, inOrg())),
      organizations: () => { expired = true; return response(401, { detail: "expired" }); },
    });
    mount();
    await settled();
    await waitFor(() => expect(document.querySelector('[data-stwrd="organization-switcher"]')).toBeNull());
  });

  it.each([
    ["selection is not enabled (404)", () => response(404, { detail: "off" })],
    ["the list is unavailable (503)", () => response(503, { detail: "silent" })],
    ["the list is malformed", () => response(200, { organizations: [{ id: "x" }] })],
    ["there is a single organization", () => response(200, listing([{ id: ORG_A, display_name: "Org A", current: true }]))],
  ])("falls back to the account link when %s", async (_name, organizations) => {
    stubFetch({ session: () => response(200, inOrg()), organizations });
    mount();
    await settled();
    const link = (await screen.findByText("Org A")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://auth.example.com/me/organizations");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("drops a late list answer once the identity changed", async () => {
    let release!: (value: Response) => void;
    let first = true;
    const mock = vi.fn(async (url: string) => {
      if (!String(url).endsWith("/organizations")) return response(200, inOrg(first ? ORG_A : ORG_B, first ? "Org A" : "Org B"));
      if (first) { first = false; return new Promise<Response>(resolve => { release = resolve; }); }
      return response(200, listing([{ id: ORG_B, display_name: "Org B", current: true }, { id: ORG_A, display_name: "Org A", current: false }]));
    });
    vi.stubGlobal("fetch", mock);
    const view = mount();
    await settled();
    await waitFor(() => expect(release).toBeDefined());
    // The identity changes (another tab switched organization) before the first list answers.
    const channel = new BroadcastChannel("stwrd:session");
    channel.postMessage("changed");
    await waitFor(() => expect(screen.getByRole("combobox")).toBeDefined());
    await act(async () => release(response(200, listing([{ id: ORG_A, display_name: "STALE", current: true }, { id: "x", display_name: "STALE-2", current: false }]))));
    expect(view.container.textContent).not.toContain("STALE");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(ORG_B);
    channel.close();
  });

  it("renders nothing once the IdP goes silent: no authority is served from the previous session", async () => {
    let silent = false;
    stubFetch({
      session: () => (silent ? response(503, { detail: "silent" }) : response(200, inOrg())),
      organizations: () => response(200, listing([{ id: ORG_A, display_name: "Org A", current: true }, { id: ORG_B, display_name: "Org B", current: false }])),
    });
    mount();
    await settled();
    await screen.findByRole("combobox");
    silent = true;
    const channel = new BroadcastChannel("stwrd:session");
    channel.postMessage("changed");
    await waitFor(() => expect(document.querySelector('[data-stwrd="organization-switcher"]')).toBeNull());
    channel.close();
  });
});

describe("cross-tab notice", () => {
  it("a tab that becomes visible again, or returns from the back/forward cache, asks again", async () => {
    const mock = stubFetch({ session: () => response(200, inOrg()), organizations: () => response(404, {}) });
    mount();
    await settled();
    const count = () => mock.mock.calls.filter(([url]) => String(url).endsWith("/session")).length;
    const before = count();
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(count()).toBeGreaterThan(before));
    const afterVisible = count();
    const restored = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);
    await waitFor(() => expect(count()).toBeGreaterThan(afterVisible));
    const afterRestore = count();
    const fresh = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(fresh, "persisted", { value: false });
    window.dispatchEvent(fresh);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(count()).toBe(afterRestore);
  });

  it("a navigation that changed the session tells the other tabs once, without any claim", async () => {
    stubFetch({ session: () => response(200, inOrg()), organizations: () => response(404, {}) });
    const received: unknown[] = [];
    const listener = new BroadcastChannel("stwrd:session");
    listener.onmessage = event => received.push(event.data);
    sessionStorage.setItem("stwrd:session-changed", "1");
    mount();
    await settled();
    await waitFor(() => expect(received).toEqual(["changed"]));
    expect(sessionStorage.getItem("stwrd:session-changed")).toBeNull();
    listener.close();
  });

  it("a notice from another tab refreshes the session", async () => {
    const mock = stubFetch({ session: () => response(200, inOrg()), organizations: () => response(404, {}) });
    mount();
    await settled();
    const before = mock.mock.calls.filter(([url]) => String(url).endsWith("/session")).length;
    const other = new BroadcastChannel("stwrd:session");
    other.postMessage("changed");
    await waitFor(() => expect(mock.mock.calls.filter(([url]) => String(url).endsWith("/session")).length).toBeGreaterThan(before));
    other.close();
  });
});
