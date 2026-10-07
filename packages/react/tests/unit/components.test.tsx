import type { ReactElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StwrdProvider } from "../../src/StwrdProvider.js";
import {
  OrganizationSwitcher,
  Protect,
  SignedIn,
  SignedOut,
  UserButton,
} from "../../src/components.js";
import { useSession } from "../../src/useSession.js";
import { LoadingProbe, sessionResponse, mockSessionFetch, mockSessionUnavailable, signedInUser } from "./fixtures.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function waitUntilSettled() {
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
}

describe("SignedIn / SignedOut", () => {
  it("SignedIn renders its children once the session resolved as authenticated", async () => {
    mockSessionFetch(sessionResponse({ authenticated: true, user: signedInUser() }));
    render(
      <StwrdProvider>
        <LoadingProbe />
        <SignedIn>
          <span>secret</span>
        </SignedIn>
      </StwrdProvider>,
    );
    expect(screen.queryByText("secret")).toBeNull();
    await waitUntilSettled();
    expect(screen.getByText("secret")).toBeInTheDocument();
  });

  it("SignedOut renders its children once the session resolved as anonymous", async () => {
    mockSessionFetch(sessionResponse());
    render(
      <StwrdProvider>
        <LoadingProbe />
        <SignedOut>
          <span>signed out</span>
        </SignedOut>
      </StwrdProvider>,
    );
    await waitUntilSettled();
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });

  it("SignedIn and SignedOut never both render for the same session", async () => {
    mockSessionFetch(sessionResponse({ authenticated: true, user: signedInUser() }));
    render(
      <StwrdProvider>
        <LoadingProbe />
        <SignedIn>
          <span>a</span>
        </SignedIn>
        <SignedOut>
          <span>b</span>
        </SignedOut>
      </StwrdProvider>,
    );
    await waitUntilSettled();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText("b")).toBeNull();
  });
});

describe("Protect", () => {
  it("renders the fallback while signed out", async () => {
    mockSessionFetch(sessionResponse());
    render(
      <StwrdProvider>
        <LoadingProbe />
        <Protect fallback={<span>outside</span>}>
          <span>inside</span>
        </Protect>
      </StwrdProvider>,
    );
    await waitUntilSettled();
    expect(screen.getByText("outside")).toBeInTheDocument();
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("renders the children when signed in and no condition was given", async () => {
    mockSessionFetch(sessionResponse({ authenticated: true, user: signedInUser() }));
    render(
      <StwrdProvider>
        <LoadingProbe />
        <Protect fallback={<span>outside</span>}>
          <span>inside</span>
        </Protect>
      </StwrdProvider>,
    );
    await waitUntilSettled();
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("condition() is called with the real signed-in user and gates on its answer", async () => {
    mockSessionFetch(
      sessionResponse({ authenticated: true, user: signedInUser({ roles: ["org:member"] }) }),
    );
    render(
      <StwrdProvider>
        <LoadingProbe />
        <Protect
          condition={(u) => u.roles.includes("org:admin")}
          fallback={<span>outside</span>}
        >
          <span>inside</span>
        </Protect>
      </StwrdProvider>,
    );
    await waitUntilSettled();
    expect(screen.getByText("outside")).toBeInTheDocument();
    expect(screen.queryByText("inside")).toBeNull();
  });
});

describe("UserButton", () => {
  it("renders nothing while signed out", async () => {
    mockSessionFetch(sessionResponse());
    const { container } = render(
      <StwrdProvider>
        <LoadingProbe />
        <UserButton />
      </StwrdProvider>,
    );
    await waitUntilSettled();
    expect(container.querySelector('[data-stwrd="user-button"]')).toBeNull();
  });

  it("shows the display name, the account link and applies className", async () => {
    mockSessionFetch(
      sessionResponse({
        authenticated: true,
        user: signedInUser({ display_name: "Demo Person" }),
        account_url: "https://auth.example.com/me",
      }),
    );
    const { container } = render(
      <StwrdProvider>
        <LoadingProbe />
        <UserButton className="my-button" />
      </StwrdProvider>,
    );
    await waitUntilSettled();
    const button = container.querySelector('[data-stwrd="user-button"]');
    expect(button?.className).toContain("my-button");
    expect(screen.getByText("Demo Person")).toBeInTheDocument();
    const accountLink = screen.getByText("Account") as HTMLAnchorElement;
    expect(accountLink.getAttribute("href")).toBe("https://auth.example.com/me");
  });

  it("falls back to email, never a blank label, when no name is set", async () => {
    mockSessionFetch(sessionResponse({ authenticated: true, user: signedInUser({ display_name: null }) }));
    render(
      <StwrdProvider>
        <LoadingProbe />
        <UserButton />
      </StwrdProvider>,
    );
    await waitUntilSettled();
    expect(screen.getByText("person@example.com")).toBeInTheDocument();
  });

  it("its sign-out control drives the same signOut() the hook exposes", async () => {
    mockSessionFetch(sessionResponse({ authenticated: true, user: signedInUser(), csrf_token: "tok" }));
    render(
      <StwrdProvider baseUrl="/auth">
        <LoadingProbe />
        <UserButton />
      </StwrdProvider>,
    );
    await waitUntilSettled();

    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    screen.getByText("Sign out").click();
    expect(submitSpy).toHaveBeenCalledOnce();
    submitSpy.mockRestore();
  });
});

describe("OrganizationSwitcher", () => {
  it("renders nothing when the session carries no organisation", async () => {
    mockSessionFetch(sessionResponse({ authenticated: true, user: signedInUser() }));
    const { container } = render(
      <StwrdProvider>
        <LoadingProbe />
        <OrganizationSwitcher />
      </StwrdProvider>,
    );
    await waitUntilSettled();
    expect(container.querySelector('[data-stwrd="organization-switcher"]')).toBeNull();
  });

  it("shows organization.display_name and links to {accountUrl}/organizations", async () => {
    mockSessionFetch(
      sessionResponse({
        authenticated: true,
        user: signedInUser(),
        organization: { id: "org-1", display_name: "Northern Clinic", roles: [], permissions: [] },
        account_url: "https://auth.example.com/me",
      }),
    );
    render(
      <StwrdProvider>
        <LoadingProbe />
        <OrganizationSwitcher className="switcher" />
      </StwrdProvider>,
    );
    await waitUntilSettled();
    const link = screen.getByText("Northern Clinic") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://auth.example.com/me/organizations");
    expect(link.className).toContain("switcher");
  });
});

describe("the provider did not answer: \"cannot tell\" is not \"no session\"", () => {
  for (const mode of ["5xx", "network"] as const) {
    it(`renders neither <SignedOut> nor the <Protect> fallback (${mode})`, async () => {
      mockSessionUnavailable(mode);
      render(
        <StwrdProvider baseUrl="/auth">
          <LoadingProbe />
          <SignedOut>
            <span data-testid="signed-out">Sign in</span>
          </SignedOut>
          <SignedIn>
            <span data-testid="signed-in">Hello</span>
          </SignedIn>
          <Protect fallback={<span data-testid="protect-fallback">No access</span>}>
            <span data-testid="protect-children">Content</span>
          </Protect>
        </StwrdProvider>,
      );

      await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

      expect(screen.queryByTestId("signed-out"), "it rendered the sign-in prompt for someone who is still signed in").toBeNull();
      expect(screen.queryByTestId("signed-in")).toBeNull();
      expect(screen.queryByTestId("protect-fallback"), "the fallback is for someone WITHOUT access, and it is not known whether they have it").toBeNull();
      expect(screen.queryByTestId("protect-children")).toBeNull();
    });
  }

  it("exposes `unavailable` so the application can say so", async () => {
    // Without this the result would be a blank screen with no explanation,
    // which is honest and useless.
    mockSessionUnavailable("5xx");

    function Probe() {
      const { status, user } = useSession();
      const unavailable = status === "unavailable";
      return (
        <span data-testid="state">{unavailable ? "cannot-tell" : String(user === null)}</span>
      );
    }

    render(
      <StwrdProvider baseUrl="/auth">
        <LoadingProbe />
        <Probe />
      </StwrdProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("cannot-tell"));
  });

  it("the gap closes by itself as soon as the provider is back", async () => {
    // What matters to the application's user: the hiccup was a gap, not an
    // ending. Without the retry the application would stay unavailable until
    // a manual reload, even if the provider came back two seconds later.
    vi.useFakeTimers();
    try {
      mockSessionUnavailable("5xx", sessionResponse({ authenticated: true, user: signedInUser() }));
      render(
        <StwrdProvider baseUrl="/auth">
          <SignedIn>
            <span data-testid="signed-in">Hello</span>
          </SignedIn>
        </StwrdProvider>,
      );

      // First let the answer to the FIRST attempt arrive (it sets
      // `unavailable` and schedules the retry); only then run the clock.
      // Without this pause the retry does not exist yet and advancing the
      // time triggers nothing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });

      expect(screen.queryByTestId("signed-in")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("with a silent provider, no guard serves the old claims", () => {
  function Refresher() {
    const { refresh, status, user } = useSession();
    const unavailable = status === "unavailable";
    return (
      <button type="button" data-testid="refresh" onClick={() => void refresh()}>
        {`${user === null ? "no" : "with"}-user-${unavailable ? "silent" : "ok"}`}
      </button>
    );
  }

  // Each guard is found its own way: the two controls are marked with
  // `data-stwrd` (their contract with whoever styles them), not with a
  // `data-testid` from the harness.
  const GUARDS: Array<[string, () => ReactElement, () => Element | null]> = [
    [
      "SignedIn",
      () => (
        <SignedIn>
          <span data-testid="g">inside</span>
        </SignedIn>
      ),
      () => screen.queryByTestId("g"),
    ],
    ["UserButton", () => <UserButton />, () => document.querySelector('[data-stwrd="user-button"]')],
    [
      "OrganizationSwitcher",
      () => <OrganizationSwitcher />,
      () => document.querySelector('[data-stwrd="organization-switcher"]'),
    ],
  ];

  for (const [name, guard, find] of GUARDS) {
    it(`${name} stops rendering as soon as the provider goes silent`, async () => {
      let silent = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          silent
            ? ({ ok: false, status: 503, json: async () => ({ detail: "silent" }) } as Response)
            : ({
                ok: true,
                status: 200,
                json: async () =>
                  sessionResponse({
                    authenticated: true,
                    user: signedInUser(),
                    organization: { id: "o1", display_name: "Acme", roles: [], permissions: [] },
                  }),
              } as Response),
        ),
      );

      render(
        <StwrdProvider baseUrl="/auth">
          <Refresher />
          {guard()}
        </StwrdProvider>,
      );

      // The first round is good: the guard RENDERS. If it did not, what
      // follows would prove nothing.
      await waitFor(() => expect(find()).not.toBeNull());

      silent = true;
      // `fireEvent` and not `userEvent`: this package does not depend on the
      // latter, and a synthetic click is enough; what is exercised is the
      // provider state, not the gesture.
      fireEvent.click(screen.getByTestId("refresh"));

      // The state under test: there is an old `user` and it cannot be revalidated.
      await waitFor(() =>
        expect(screen.getByTestId("refresh").textContent).toBe("with-user-silent"),
      );
      expect(find(), `${name} rendered claims that nobody could revalidate`).toBeNull();
    });
  }
});
