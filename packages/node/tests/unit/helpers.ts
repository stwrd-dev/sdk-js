/**
 * Shared test wiring for the unit suite, as plain functions since
 * vitest has no fixture injection.
 */

import type { FetchLike } from "@stwrd-auth/core/oidc";
import { FakeIdp, type FakeIdpOptions } from "../fixtures/fakeIdp.js";

export const CLIENT_ID = "demo-client";
export const CLIENT_SECRET = "demo-secret";
export const BASE_URL = "https://demo.test";

/** Starts a `FakeIdp` and returns it plus a `FetchLike` bound to its
 * loopback server — the Node analogue of `idp_http_client` (an
 * `httpx.AsyncClient` over `ASGITransport`). Node's `fetch` already talks
 * real HTTP, so this is just `globalThis.fetch` with nothing swapped in;
 * the helper exists so every test starts/stops the same way and nobody
 * forgets `idp.stop()`. */
export async function withFakeIdp<T>(
  options: Partial<FakeIdpOptions>,
  run: (idp: FakeIdp, fetchImpl: FetchLike, issuer: string) => Promise<T>,
): Promise<T> {
  const idp = new FakeIdp({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: `${BASE_URL}/auth/callback`,
    ...options,
  });
  const issuer = await idp.start();
  try {
    return await run(idp, fetch as FetchLike, issuer);
  } finally {
    await idp.stop();
  }
}
