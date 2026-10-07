/**
 * The signed-in person's own organizations, read with their access token.
 *
 * `GET {management}/me/memberships` is a self-read: the bearer is the person's
 * access token and it only ever lists that person's usable memberships for this
 * application. The destination comes from the issuer's discovery document and
 * is validated (HTTPS, token endpoint on the issuer origin, audience-consistent;
 * the account host may legitimately differ from a custom login domain) before any token
 * is sent; redirects are never followed with the token.
 */

import { validateManagementDiscovery } from "./managementTransport.js";
import { type Discovery, type FetchLike, IdpUnavailable } from "./oidc.js";

const MAX_PAGES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OwnOrganization {
  id: string;
  displayName: string | null;
}

export async function listOwnOrganizations(
  fetchImpl: FetchLike, issuer: string, discovery: Discovery, accessToken: string,
): Promise<OwnOrganization[]> {
  let baseUrl: string;
  try {
    baseUrl = validateManagementDiscovery(issuer, discovery.document).baseUrl;
  } catch (exc) {
    throw new IdpUnavailable(`Management destination rejected: ${(exc as Error).message}`, false);
  }
  const found = new Map<string, OwnOrganization>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${baseUrl}/me/memberships`);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    let response: Response;
    try {
      response = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, redirect: "manual" });
    } catch (exc) {
      throw new IdpUnavailable(`Memberships: the IdP did not respond (${(exc as Error).message}).`);
    }
    // "manual", not "error" (workerd's `fetch` throws on "error" for every request):
    // the bearer token never follows a redirect, which is refused here.
    if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      // With `manual` the 3xx has a body and the connection stays held until it
      // is read or cancelled: release it before refusing.
      await response.body?.cancel().catch(() => {});
      throw new IdpUnavailable("Memberships: redirects are refused.");
    }
    if (response.status !== 200) throw new IdpUnavailable(`Memberships: the IdP responded ${response.status}.`);
    let next: unknown;
    try {
      const body = (await response.json()) as { items: Array<{ active: boolean; organization: { id: string; display_name: unknown } }>; page: { next_cursor: unknown } };
      for (const item of body.items) {
        if (item.active !== true) continue;
        const id = item.organization.id;
        if (typeof id !== "string" || !UUID.test(id)) throw new Error("invalid organization id");
        const name = item.organization.display_name;
        found.set(id.toLowerCase(), { id: id.toLowerCase(), displayName: typeof name === "string" ? name : null });
      }
      next = body.page.next_cursor;
    } catch {
      throw new IdpUnavailable("Memberships: unreadable response.");
    }
    if (next === null) return [...found.values()];
    if (typeof next !== "string" || !next || seen.has(next)) throw new IdpUnavailable("Memberships: repeated or invalid cursor.");
    seen.add(next);
    cursor = next;
  }
  throw new IdpUnavailable("Memberships: too many pages.");
}
