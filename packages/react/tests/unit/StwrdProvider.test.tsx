import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StwrdProvider } from "../../src/StwrdProvider.js";
import { useSession } from "../../src/useSession.js";
import { sessionResponse, mockSessionFetch, mockSessionMalformed, signedInUser } from "./fixtures.js";

function Probe() {
  const { user, status, accountUrl } = useSession();
  const loading = status === "loading", unavailable = status === "unavailable";
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="email">{user?.email ?? "none"}</span>
      <span data-testid="account-url">{accountUrl}</span>
      <span data-testid="unavailable">{String(unavailable)}</span>
      {/* `user === null`, not `!user`: tells "no session" apart from `undefined`,
       * which is exactly what a malformed body could leave behind. */}
      <span data-testid="user-is-null">{String(user === null)}</span>
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StwrdProvider / useSession", () => {
  it("starts loading and resolves into what /auth/session answered", async () => {
    mockSessionFetch(
      sessionResponse({
        authenticated: true,
        user: signedInUser(),
        account_url: "https://x.test/me",
      }),
    );
    render(
      <StwrdProvider baseUrl="/auth">
        <Probe />
      </StwrdProvider>,
    );

    expect(screen.getByTestId("loading").textContent).toBe("true");
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("email").textContent).toBe("person@example.com");
    expect(screen.getByTestId("account-url").textContent).toBe("https://x.test/me");
  });

  it("fetches exactly {baseUrl}/session, with credentials, never a hardcoded path", async () => {
    const fetchMock = mockSessionFetch(sessionResponse());
    render(
      <StwrdProvider baseUrl="/custom-auth">
        <Probe />
      </StwrdProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/custom-auth/session", { credentials: "include", cache: "no-store" });
  });

  it("an unauthenticated /auth/session resolves to a null user, never an error", async () => {
    mockSessionFetch(sessionResponse());
    render(
      <StwrdProvider>
        <Probe />
      </StwrdProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("email").textContent).toBe("none");
  });

  it("refresh() re-queries /auth/session and the new answer replaces the old user", async () => {
    const fetchMock = mockSessionFetch(
      sessionResponse(),
      sessionResponse({
        authenticated: true,
        user: signedInUser({ email: "new@example.com" }),
      }),
    );
    let refresh: (() => Promise<void>) | undefined;
    function Capture() {
      refresh = useSession().refresh;
      return <Probe />;
    }
    render(
      <StwrdProvider>
        <Capture />
      </StwrdProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("email").textContent).toBe("none"));

    await act(async () => {
      await refresh!();
    });

    expect(screen.getByTestId("email").textContent).toBe("new@example.com");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("useSession() outside <StwrdProvider> throws instead of returning a silent default", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow();
    consoleError.mockRestore();
  });
});

// Until `refresh()` caught these two cases, the `/auth/session` promise stayed
// unresolved or the state filled up with a half-built `user`, and neither
// showed on screen as an error.
describe("StwrdProvider with a malformed /auth/session answer", () => {
  it("a body that is not JSON never leaves loading stuck at true", async () => {
    mockSessionMalformed("no-json");
    render(
      <StwrdProvider>
        <Probe />
      </StwrdProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    // Read as "cannot tell", never as "no session": it is the same fact as a
    // 5xx from the server, and the guards treat it the same way.
    expect(screen.getByTestId("unavailable").textContent).toBe("true");
  });

  it("JSON without the `user` key normalizes to null, never leaves `undefined`", async () => {
    mockSessionMalformed("no-user");
    render(
      <StwrdProvider>
        <Probe />
      </StwrdProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("user-is-null").textContent).toBe("true");
  });
});

describe("StwrdProvider.signOut", () => {
  it("submits a real POST form to {baseUrl}/sign-out carrying the csrf_token", async () => {
    mockSessionFetch(
      sessionResponse({ authenticated: true, user: signedInUser(), csrf_token: "the-csrf-token" }),
    );
    let signOut: (() => void) | undefined;
    function Capture() {
      signOut = useSession().signOut;
      return <Probe />;
    }
    render(
      <StwrdProvider baseUrl="/auth">
        <Capture />
      </StwrdProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    // `/auth/sign-out` is a POST and not a GET on purpose: the whole
    // point of `signOut()` is a real browser navigation across two hosts
    // (this app's, then the IdP's `end-session`), which `fetch` cannot do
    // (it would follow the redirect itself, in the background, and a
    // cross-origin hop with no CORS headers fails outright). jsdom does not
    // implement `HTMLFormElement.submit()`, so it is stubbed here purely to
    // observe the form it would have submitted.
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    act(() => {
      signOut!();
    });

    expect(submitSpy).toHaveBeenCalledOnce();
    const form = submitSpy.mock.instances[0] as HTMLFormElement;
    expect(form.method).toBe("post");
    expect(form.getAttribute("action")).toBe("/auth/sign-out");
    const csrfField = form.querySelector('input[name="csrf_token"]') as HTMLInputElement;
    expect(csrfField.value).toBe("the-csrf-token");

    submitSpy.mockRestore();
  });
});
