import { vi } from "vitest";

import { useSession } from "../../src/useSession.js";
import type { SessionResponse, StwrdUser } from "../../src/types.js";

export function sessionResponse(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    authenticated: false,
    user: null,
    organization: null,
    consents: {},
    account_url: "https://auth.example.com/me",
    ...overrides,
    csrf_token: overrides.authenticated ? (overrides.csrf_token ?? "csrf") : null,
  };
}

export function signedInUser(overrides: Partial<StwrdUser> = {}): StwrdUser {
  return {
    id: "1f2e3d4c-5b6a-7988-9a0b-c1d2e3f4a5b6",
    email: "person@example.com",
    email_verified: true,
    display_name: "Demo Person",
    avatar_url: null,

    roles: [],
    permissions: [],
    ...overrides,
  };
}

export function mockSessionFetch(...responses: SessionResponse[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const body = queue.length > 1 ? queue.shift()! : (queue[0] ?? sessionResponse());
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function mockSessionUnavailable(
  mode: "5xx" | "network",
  then?: SessionResponse,
): ReturnType<typeof vi.fn> {
  let served = false;
  const fetchMock = vi.fn(async () => {
    if (!served) {
      served = true;
      if (mode === "network") {
        throw new TypeError("network error");
      }
      return { ok: false, status: 503, json: async () => ({ detail: "The IdP did not respond." }) } as Response;
    }
    if (!then) {
      return { ok: false, status: 503, json: async () => ({ detail: "The IdP did not respond." }) } as Response;
    }
    return { ok: true, status: 200, json: async () => then } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function mockSessionMalformed(mode: "no-json" | "no-user"): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    if (mode === "no-json") {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function LoadingProbe() {
  const loading = useSession().status === "loading";
  return <span data-testid="loading">{String(loading)}</span>;
}
