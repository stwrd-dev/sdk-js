/** Server-only transport. Resource methods are generated from the mounted API schema. */
export interface ManagementOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes?: readonly string[];
  fetch?: typeof globalThis.fetch;
}
export type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[];
export type ManagementQuery = Record<string, QueryValue>;

export interface WriteOptions {
  ifMatch?: string;
  idempotencyKey?: string;
  confirmationToken?: string;
  stepUpToken?: string;
  responseType?: "json" | "bytes";
}
export interface ApiResult<T> {
  data: T;
  etag: string | null;
  requestId: string | null;
}
export class ManagementError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly requestId: string | null,
  ) {
    super(`Management request failed (${status})`);
    this.name = "ManagementError";
  }
}
function httpsUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Missing discovery destination");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Management destinations must be HTTPS URLs without credentials or fragments");
  }
  return url;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export interface ManagementDiscovery {
  tokenEndpoint: string;
  baseUrl: string;
  audience: string;
}
/** Validate discovery before either a service secret or a user's bearer token is sent. */
export function validateManagementDiscovery(issuer: string, body: unknown): ManagementDiscovery {
  const expected = httpsUrl(issuer).href.replace(/\/$/, "");
  if (!record(body) || body.issuer !== expected) throw new Error("Discovery issuer mismatch");
  const token = httpsUrl(body.token_endpoint);
  const base = httpsUrl(body.management_api_base_url);
  const audience = httpsUrl(body.management_api_audience);
  if (token.origin !== new URL(expected).origin) throw new Error("Foreign token destination");
  const registeredAudience = audience.href.replace(/\/$/, "");
  if (base.href.replace(/\/$/, "") !== `${registeredAudience}/api/v1`) {
    throw new Error("Management destination does not match its registered audience");
  }
  return { tokenEndpoint: token.href, baseUrl: base.href.replace(/\/$/, ""), audience: registeredAudience };
}
export class ManagementTransport {
  private readonly issuer: string;
  private readonly fetcher: typeof globalThis.fetch;
  private discoveryFlight?: Promise<ManagementDiscovery>;
  private discoveryCache?: { value: ManagementDiscovery; validUntil: number };
  private tokenFlight?: { binding: string; promise: Promise<string> };
  private token?: { value: string; validUntil: number; binding: string };
  constructor(private readonly options: ManagementOptions) {
    if (!options.clientId || !options.clientSecret) throw new Error("Management credentials required");
    this.issuer = httpsUrl(options.issuer).href.replace(/\/$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (options.scopes?.some(scope => !scope || /\s/.test(scope))) throw new Error("Invalid scope");
  }
  private async read(url: string, init?: RequestInit): Promise<Response> {
    // "manual", not "error": workerd's `fetch` throws on `redirect: "error"` for
    // every request. A redirect is refused here instead, before the body is read.
    const response = await this.fetcher(url, { ...init, redirect: "manual" });
    if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      // With `manual` the 3xx has a body and the connection stays held until it
      // is read or cancelled: release it before refusing.
      await response.body?.cancel().catch(() => {});
      throw new Error("Management redirects are forbidden");
    }
    return response;
  }
  private async discover(): Promise<ManagementDiscovery> {
    if (this.discoveryCache && this.discoveryCache.validUntil > Date.now()) return this.discoveryCache.value;
    if (!this.discoveryFlight) {
      const flight = (async () => {
        const response = await this.read(`${this.issuer}/.well-known/openid-configuration`);
        if (!response.ok) throw new ManagementError(response.status, null, response.headers.get("X-Request-ID"));
        const body: unknown = await response.json();
        const value = validateManagementDiscovery(this.issuer, body);
        const control = response.headers.get("Cache-Control") ?? "";
        const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(control);
        const ttl = /(?:^|,)\s*(?:no-store|no-cache)(?:\s|,|=|$)/i.test(control) ? 0 : Math.min(60, maxAge ? Number(maxAge[1]) : 30);
        this.discoveryCache = { value, validUntil: Date.now() + ttl * 1000 };
        return value;
      })();
      this.discoveryFlight = flight;
      void flight.finally(() => { if (this.discoveryFlight === flight) this.discoveryFlight = undefined; }).catch(() => {});
    }
    return this.discoveryFlight;
  }
  private async accessToken(discovery: ManagementDiscovery): Promise<string> {
    const binding = JSON.stringify([discovery.tokenEndpoint, discovery.baseUrl, discovery.audience]);
    if (this.token && this.token.binding === binding && this.token.validUntil > Date.now()) return this.token.value;
    if (!this.tokenFlight || this.tokenFlight.binding !== binding) {
      const flight = (async () => {
        const body = new URLSearchParams({ grant_type: "client_credentials" });
        if (this.options.scopes?.length) body.set("scope", this.options.scopes.join(" "));
        const credential = Buffer.from(
          `${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`,
        ).toString("base64");
        const acquiredAt = Date.now();
        const response = await this.read(discovery.tokenEndpoint, {
          method: "POST", headers: { Authorization: `Basic ${credential}` }, body,
        });
        const result: unknown = response.ok ? await response.json() : await response.json().catch(() => null);
        if (!response.ok) throw new ManagementError(response.status, result, response.headers.get("X-Request-ID"));
        if (!record(result) || typeof result.access_token !== "string" || !result.access_token ||
            typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer" ||
            typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) {
          throw new Error("Invalid client credentials token response");
        }
        const validUntil = acquiredAt + result.expires_in * 900;
        if (validUntil <= Date.now()) throw new Error("Management token expired during acquisition");
        this.token = { value: result.access_token, validUntil, binding };
        return result.access_token;
      })();
      const owner = { binding, promise: flight };
      this.tokenFlight = owner;
      void flight.finally(() => { if (this.tokenFlight === owner) this.tokenFlight = undefined; }).catch(() => {});
    }
    return this.tokenFlight.promise;
  }
  async request<T>(
    method: string, path: string, input?: unknown,
    options: WriteOptions = {}, query: ManagementQuery = {},
  ): Promise<ApiResult<T>> {
    if (!path.startsWith("/") || path.includes("\\") || path.includes("?") || path.includes("#") ||
        path.split("/").some(segment => {
          const decoded = decodeURIComponent(segment);
          return decoded === ".." || decoded === "." || decoded.includes("/") || decoded.includes("\\");
        })) {
      throw new Error("Invalid management resource path");
    }
    const discovery = await this.discover();
    const url = new URL(discovery.baseUrl + path);
    if (url.origin !== new URL(discovery.baseUrl).origin || !url.pathname.startsWith("/api/v1/")) {
      throw new Error("Foreign management resource path");
    }
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) { for (const item of value) url.searchParams.append(key, String(item)); }
      else url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ Authorization: `Bearer ${await this.accessToken(discovery)}`, Accept: "application/json" });
    const multipart = input instanceof FormData;
    if (input !== undefined && !multipart) headers.set("Content-Type", "application/json");
    if (options.ifMatch !== undefined) headers.set("If-Match", options.ifMatch);
    if (options.idempotencyKey !== undefined) headers.set("Idempotency-Key", options.idempotencyKey);
    if (options.confirmationToken !== undefined) headers.set("Confirmation-Token", options.confirmationToken);
    if (options.stepUpToken !== undefined) headers.set("X-Stwrd-Step-Up", options.stepUpToken);
    const sentToken = headers.get("Authorization");
    const response = await this.read(url.href, { method, headers, body: input === undefined ? undefined : multipart ? input : JSON.stringify(input) });
    const data: unknown = response.status === 204 ? undefined :
      !response.ok ? await response.json().catch(() => null) :
      options.responseType === "bytes" ? new Uint8Array(await response.arrayBuffer()) : await response.json();
    if (!response.ok) {
      if (response.status === 401 && `Bearer ${this.token?.value}` === sentToken) this.token = undefined;
      throw new ManagementError(response.status, data, response.headers.get("X-Request-ID"));
    }
    return { data: data as T, etag: response.headers.get("ETag"), requestId: response.headers.get("X-Request-ID") };
  }
  async *iterate<T = { id: string }>(
    path: string, query: ManagementQuery = {},
    identity: (item: T) => string | number = item => (item as { id: string }).id,
  ): AsyncGenerator<T> {
    if (query.cursor !== undefined && query.cursor !== null &&
        (typeof query.cursor !== "string" || !query.cursor)) throw new Error("Invalid initial cursor");
    let cursor = query.cursor as string | undefined;
    const cursors = new Set<string>();
    const ids = new Set<string | number>();
    if (cursor) cursors.add(cursor);
    do {
      const page = (await this.request<{ items: T[]; page: { next_cursor: string | null } }>("GET", path, undefined, {}, { ...query, cursor })).data;
      if (!page || !Array.isArray(page.items) || !record(page.page) ||
          (page.page.next_cursor !== null && typeof page.page.next_cursor !== "string")) throw new Error("Invalid management page");
      for (const item of page.items) {
        const id = identity(item);
        if ((typeof id !== "string" && typeof id !== "number") || ids.has(id)) throw new Error("Repeated or invalid resource in cursor traversal");
        ids.add(id); yield item;
      }
      cursor = page.page.next_cursor ?? undefined;
      if (cursor !== undefined && (!cursor || cursors.has(cursor))) throw new Error("Repeated management cursor");
      if (cursor !== undefined) cursors.add(cursor);
    } while (cursor !== undefined);
  }
}
