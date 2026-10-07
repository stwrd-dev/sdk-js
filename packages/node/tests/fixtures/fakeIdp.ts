/**
 * A minimal OIDC provider that follows the protocol — a test double, not a
 * second identity provider. A unit suite should not need a database or a
 * login screen to exercise `OidcClient`.
 *
 * By default it listens on real loopback TCP — `oidc.ts`'s injected
 * `FetchLike` is a real HTTP client either way in Node. "No external process,
 * no fixed port, torn down every test" is the property this buys.
 *
 * `mode: "handler"` drops the socket altogether: `start()` only generates the
 * keys, `fetch` (a `FetchLike`) and `handler` (`Request → Response`) serve the
 * same routes in-process, with nothing from `node:http` or `node:net`
 * evaluated — what lets the same scenarios run inside workerd.
 */

import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";

import * as jose from "jose";

export const KID = "test-kid-1";
export const ALG = "RS256";

function b64url(raw: Uint8Array): string {
  return Buffer.from(raw).toString("base64url");
}

function halfHash(token: string): string {
  const digest = createHash("sha256").update(Buffer.from(token, "ascii")).digest();
  return b64url(digest.subarray(0, digest.length / 2));
}

interface CodeEntry {
  idClaims: Record<string, unknown>;
  sub: string;
  nonce: string | null;
  userinfo: Record<string, unknown>;
  withRefresh: boolean;
}

interface RefreshEntry {
  idClaims: Record<string, unknown>;
  sub: string;
  userinfo: Record<string, unknown>;
  sid: string;
}

export interface FakeIdpOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  advertiseEndSession?: boolean;
  /** `null` means "reject every refresh_token grant with invalid_grant" —
   * the default of 200 means "accept"; any
   * non-200 here makes every refresh fail with that status. */
  refreshStatusCode?: number;
  /** The issuer origin the SDK sees (e.g. `https://auth.example.com`); the test
   * routes it to the loopback server with its own `fetch`. Defaults to the
   * loopback address. */
  publicIssuer?: string;
  /** `"server"` (default): a loopback TCP server. `"handler"`: no socket; the
   * IdP answers through `fetch`/`handler`, and its issuer is `publicIssuer`
   * (default `HANDLER_ISSUER`). */
  mode?: "server" | "handler";
}

/** The issuer of a `FakeIdp` in handler mode when no `publicIssuer` is given. */
export const HANDLER_ISSUER = "https://idp.fake.test";

export class FakeIdp {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly advertiseEndSession: boolean;
  refreshStatusCode: number;
  private readonly publicIssuer?: string;
  private readonly mode: "server" | "handler";
  /** `GET /api/v1/me/memberships` items, served `membershipsPageSize` at a
   * time, or answered with `membershipsStatus` when it is not 200. */
  memberships: Array<{ organization: { id: string; display_name: string | null }; active: boolean }> = [];
  membershipsPageSize = 200;
  membershipsStatus = 200;
  /** Management destination advertised by discovery; tests override it. */
  managementBaseUrl?: string;
  managementAudience?: string;
  /** Authorization headers presented to the memberships endpoint. */
  readonly membershipAuthorizations: string[] = [];

  readonly refreshCalls: string[] = [];

  private readonly codes = new Map<string, CodeEntry>();
  private readonly userinfoByToken = new Map<string, Record<string, unknown>>();
  private readonly refreshTokens = new Map<string, RefreshEntry>();

  private keyPair: jose.GenerateKeyPairResult | null = null;
  private publicJwk: Record<string, unknown> | null = null;
  private server: Server | null = null;
  issuer = "";
  /** Where the loopback server really listens (differs from `issuer` when a
   * `publicIssuer` is configured). */
  localOrigin = "";

  constructor(options: FakeIdpOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.advertiseEndSession = options.advertiseEndSession ?? false;
    this.refreshStatusCode = options.refreshStatusCode ?? 200;
    this.publicIssuer = options.publicIssuer;
    this.mode = options.mode ?? "server";
  }

  /** The IdP as a `FetchLike`: every call is answered in-process by `handler`,
   * whatever the mode. */
  readonly fetch = (input: string, init?: RequestInit): Promise<Response> => this.handler(new Request(input, init));

  async start(): Promise<string> {
    this.keyPair = await jose.generateKeyPair(ALG, { extractable: true });
    const jwk = await jose.exportJWK(this.keyPair.publicKey);
    this.publicJwk = { ...jwk, kid: KID, alg: ALG, use: "sig" };

    if (this.mode === "handler") {
      this.issuer = this.publicIssuer ?? HANDLER_ISSUER;
      return this.issuer;
    }
    // Imported here, not at the top: handler mode must not evaluate `node:http`.
    const { createServer } = await import("node:http");
    this.server = createServer((req, res) => {
      this.serve(req)
        .then(async (response) => {
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch((exc) => {
          res.statusCode = 500;
          res.end(String(exc));
        });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, "127.0.0.1", resolve));
    const address = this.server.address() as AddressInfo;
    this.localOrigin = `http://127.0.0.1:${address.port}`;
    this.issuer = this.publicIssuer ?? this.localOrigin;
    return this.issuer;
  }

  async stop(): Promise<void> {
    if (this.mode === "handler") {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** The loopback server's request, as the `Request` `handler` takes. */
  private async serve(req: IncomingMessage): Promise<Response> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const body = req.method === "GET" || req.method === "HEAD" ? null : Buffer.concat(chunks);
    return this.handler(new Request(new URL(req.url ?? "/", this.localOrigin), { method: req.method, headers, body, redirect: "manual" }));
  }

  issueCode(options: {
    sub: string;
    idClaims?: Record<string, unknown>;
    nonce?: string | null;
    userinfo?: Record<string, unknown>;
    withRefresh?: boolean;
  }): string {
    const code = b64url(randomBytes(16));
    const body = { sub: options.sub, ...(options.userinfo ?? {}) };
    this.codes.set(code, {
      sub: options.sub,
      idClaims: options.idClaims ?? {},
      nonce: options.nonce ?? null,
      userinfo: body,
      withRefresh: options.withRefresh ?? false,
    });
    return code;
  }

  /** Exposed for tests that need a hand-built token — an expired one, one
   * with the wrong `aud`, a `logout_token` — signed with this same key. */
  async sign(claims: Record<string, unknown>): Promise<string> {
    if (!this.keyPair) {
      throw new Error("FakeIdp.start() has not run yet.");
    }
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg: ALG, kid: KID })
      .sign(this.keyPair.privateKey);
  }

  /** A hand-assembled `header.payload.` with an empty signature —
   * `jose.SignJWT` refuses to mint `alg: none` on purpose, so this bypasses
   * it the way an attacker would: build the two JWS segments directly.
   * Exists to prove `OidcClient` rejects a token whose `alg` it is told to
   * trust blindly (`sesiones-y-tokens.md`'s CVE-2015-9235-shaped attack). */
  forgeUnsigned(claims: Record<string, unknown>, options: { alg?: string; kid?: string } = {}): string {
    const header = { alg: options.alg ?? "none", kid: options.kid ?? KID };
    const headerB64 = b64url(Buffer.from(JSON.stringify(header), "utf-8"));
    const payloadB64 = b64url(Buffer.from(JSON.stringify(claims), "utf-8"));
    return `${headerB64}.${payloadB64}.`;
  }

  userinfoFor(accessToken: string): Record<string, unknown> | undefined {
    return this.userinfoByToken.get(accessToken);
  }

  refreshEntryFor(refreshToken: string): RefreshEntry | undefined {
    return this.refreshTokens.get(refreshToken);
  }

  private async mintSigned(options: {
    idClaims: Record<string, unknown>;
    sub: string;
    userinfo: Record<string, unknown>;
    nonce: string | null;
    sid: string;
  }): Promise<Record<string, unknown>> {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = b64url(randomBytes(24));
    const idClaims: Record<string, unknown> = {
      iss: this.issuer,
      aud: [this.clientId],
      sub: options.sub,
      iat: now,
      exp: now + 3600,
      auth_time: now,
      sid: options.sid,
      at_hash: halfHash(accessToken),
      ...options.idClaims,
    };
    if (options.nonce) {
      idClaims.nonce = options.nonce;
    }
    this.userinfoByToken.set(accessToken, { sid: options.sid, ...options.userinfo });
    return {
      access_token: accessToken,
      id_token: await this.sign(idClaims),
      token_type: "Bearer",
      expires_in: 3600,
    };
  }

  /** The IdP's routes on `Request → Response` terms; both modes go through here. */
  readonly handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      const doc: Record<string, unknown> = {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/oidc/authorize`,
        token_endpoint: `${this.issuer}/oidc/token`,
        userinfo_endpoint: `${this.issuer}/oidc/userinfo`,
        jwks_uri: `${this.issuer}/.well-known/jwks.json`,
        management_api_base_url: this.managementBaseUrl ?? `${this.issuer}/api/v1`,
        management_api_audience: this.managementAudience ?? this.issuer,
      };
      if (this.advertiseEndSession) {
        doc.end_session_endpoint = `${this.issuer}/oidc/end-session`;
      }
      return json(200, doc);
    }
    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      return json(200, { keys: [this.publicJwk] }, { "Cache-Control": "public, max-age=60" });
    }
    if (req.method === "POST" && url.pathname === "/oidc/token") {
      return this.handleToken(new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer())));
    }
    if (req.method === "GET" && url.pathname === "/api/v1/me/memberships") {
      this.membershipAuthorizations.push(req.headers.get("authorization") ?? "");
      if (this.membershipsStatus !== 200) return json(this.membershipsStatus, { detail: "x" });
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const end = start + this.membershipsPageSize;
      return json(200, {
        items: this.memberships.slice(start, end),
        page: { next_cursor: end < this.memberships.length ? String(end) : null, total: null },
      });
    }
    if (req.method === "GET" && url.pathname === "/oidc/userinfo") {
      const auth = req.headers.get("authorization") ?? "";
      if (!auth.startsWith("Bearer ")) {
        return json(401, { error: "invalid_token" });
      }
      const entry = this.userinfoByToken.get(auth.slice("Bearer ".length));
      if (!entry) {
        return json(401, { error: "invalid_token" });
      }
      return json(200, entry);
    }
    if (req.method === "GET" && url.pathname === "/oidc/end-session") {
      const destination = url.searchParams.get("post_logout_redirect_uri") ?? "/";
      return new Response(null, { status: 302, headers: { Location: destination } });
    }
    return new Response(null, { status: 404 });
  };

  private async handleToken(form: URLSearchParams): Promise<Response> {
    const grantType = form.get("grant_type");
    if (grantType === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      this.refreshCalls.push(presented);
      const entry = this.refreshTokens.get(presented);
      this.refreshTokens.delete(presented);
      if (
        !entry ||
        this.refreshStatusCode !== 200 ||
        form.get("client_id") !== this.clientId ||
        form.get("client_secret") !== this.clientSecret
      ) {
        return json(this.refreshStatusCode || 400, { error: "invalid_grant" });
      }
      const minted = await this.mintSigned({ sub: entry.sub, idClaims: entry.idClaims, userinfo: entry.userinfo, nonce: null, sid: entry.sid });
      const newRefresh = b64url(randomBytes(24));
      this.refreshTokens.set(newRefresh, entry);
      minted.refresh_token = newRefresh;
      return json(200, minted);
    }

    const code = form.get("code") ?? "";
    const entry = this.codes.get(code);
    this.codes.delete(code);
    if (
      !entry ||
      form.get("client_id") !== this.clientId ||
      form.get("client_secret") !== this.clientSecret ||
      form.get("redirect_uri") !== this.redirectUri
    ) {
      return json(400, { error: "invalid_grant" });
    }
    const sid = b64url(randomBytes(12));
    const minted = await this.mintSigned({ sub: entry.sub, idClaims: entry.idClaims, userinfo: entry.userinfo, nonce: entry.nonce, sid });
    if (entry.withRefresh) {
      const refreshToken = b64url(randomBytes(24));
      this.refreshTokens.set(refreshToken, { sub: entry.sub, idClaims: entry.idClaims, userinfo: entry.userinfo, sid });
      minted.refresh_token = refreshToken;
    }
    return json(200, minted);
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
