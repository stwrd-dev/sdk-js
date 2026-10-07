// A minimal OIDC provider as an in-process `FetchLike`: no socket, so the same
// suite drives the core on Node and on workerd. Keys are generated per
// instance (nothing to go stale). It is a test double, not a second IdP: it
// issues the codes and tokens the handler asks for and can be silenced to
// model an IdP that does not answer.
import { randomBytes } from "node:crypto";

import * as jose from "jose";

import { type RefreshTuning, StwrdCore } from "../../src/client.js";
import { LOGOUT_EVENT_URI, halfHash } from "../../src/oidc.js";

export const ISSUER = "https://idp.example";
export const CLIENT_ID = "client-1";
export const CLIENT_SECRET = "shh";
export const BASE_URL = "https://app.example";
export const COOKIE_SECRET = "k".repeat(32);
const KID = "k-1";
const b64url = (size: number) => randomBytes(size).toString("base64url");

interface Issued {
  sub: string;
  nonce: string | null;
  idClaims: Record<string, unknown>;
  userinfo: Record<string, unknown>;
  withRefresh: boolean;
}

export class InProcessIdp {
  silent = false;
  advertiseEndSession = false;
  memberships: Array<{ organization: { id: string; display_name: string | null }; active: boolean }> = [];
  readonly calls: string[] = [];
  private readonly codes = new Map<string, Issued>();
  private readonly refreshTokens = new Map<string, Issued & { sid: string }>();
  private readonly userinfo = new Map<string, Record<string, unknown>>();

  private constructor(private readonly keys: jose.GenerateKeyPairResult, private readonly jwk: jose.JWK) {}

  static async create(): Promise<InProcessIdp> {
    const keys = await jose.generateKeyPair("RS256", { extractable: true });
    return new InProcessIdp(keys, { ...(await jose.exportJWK(keys.publicKey)), kid: KID, alg: "RS256", use: "sig" });
  }

  /** The `fetch` the SDK is given. */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as string, init);
    const url = new URL(request.url);
    this.calls.push(`${request.method} ${url.pathname}`);
    if (this.silent) {
      throw new TypeError("fetch failed");
    }
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    if (url.pathname === "/.well-known/openid-configuration") {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oidc/authorize`,
        token_endpoint: `${ISSUER}/oidc/token`,
        userinfo_endpoint: `${ISSUER}/oidc/userinfo`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        management_api_base_url: `${ISSUER}/api/v1`,
        management_api_audience: ISSUER,
        ...(this.advertiseEndSession ? { end_session_endpoint: `${ISSUER}/oidc/end-session` } : {}),
      });
    }
    if (url.pathname === "/.well-known/jwks.json") {
      return json({ keys: [this.jwk] }, 200, { "cache-control": "public, max-age=60" });
    }
    if (url.pathname === "/oidc/token") {
      return this.token(new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer())), json);
    }
    if (url.pathname === "/oidc/userinfo") {
      const entry = this.userinfo.get((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
      return entry ? json(entry) : json({ error: "invalid_token" }, 401);
    }
    if (url.pathname === "/api/v1/me/memberships") {
      return json({ items: this.memberships, page: { next_cursor: null, total: null } });
    }
    return new Response("not found", { status: 404 });
  };

  /** A code the callback can exchange. */
  issueCode(options: { sub?: string; nonce: string | null; idClaims?: Record<string, unknown>; userinfo?: Record<string, unknown>; withRefresh?: boolean }): string {
    const code = b64url(16);
    const sub = options.sub ?? "usr_1";
    this.codes.set(code, {
      sub, nonce: options.nonce, idClaims: options.idClaims ?? {}, withRefresh: options.withRefresh ?? false,
      userinfo: { sub, email: "persona@example.test", email_verified: true, name: "Persona", ...options.userinfo },
    });
    return code;
  }

  /** A token signed with the key the IdP publishes (a `logout_token`, say). */
  sign(claims: Record<string, unknown>): Promise<string> {
    return new jose.SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: KID }).sign(this.keys.privateKey);
  }

  async logoutToken(options: { sid: string; jti: string; expiresInS?: number }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return this.sign({
      iss: ISSUER, aud: [CLIENT_ID], iat: now, exp: now + (options.expiresInS ?? 120), jti: options.jti, sid: options.sid,
      events: { [LOGOUT_EVENT_URI]: {} },
    });
  }

  private async token(form: URLSearchParams, json: (body: unknown, status?: number) => Response): Promise<Response> {
    if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) {
      return json({ error: "invalid_client" }, 401);
    }
    let issued: (Issued & { sid?: string }) | undefined;
    let sid = b64url(9);
    if (form.get("grant_type") === "refresh_token") {
      const entry = this.refreshTokens.get(form.get("refresh_token") ?? "");
      this.refreshTokens.delete(form.get("refresh_token") ?? "");
      issued = entry;
      sid = entry?.sid ?? sid;
    } else {
      issued = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      if (issued && form.get("redirect_uri") !== `${BASE_URL}/auth/callback`) issued = undefined;
    }
    if (!issued) {
      return json({ error: "invalid_grant" }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    const accessToken = b64url(24);
    const idClaims: Record<string, unknown> = {
      iss: ISSUER, aud: [CLIENT_ID], sub: issued.sub, iat: now, exp: now + 3600, sid,
      at_hash: halfHash(accessToken, "RS256"), ...issued.idClaims,
      ...(issued.nonce ? { nonce: issued.nonce } : {}),
    };
    this.userinfo.set(accessToken, { sid, ...issued.userinfo });
    const body: Record<string, unknown> = {
      access_token: accessToken, id_token: await this.sign(idClaims), token_type: "Bearer", expires_in: 3600,
    };
    if (issued.withRefresh) {
      const refresh = b64url(24);
      this.refreshTokens.set(refresh, { ...issued, sid, nonce: null });
      body.refresh_token = refresh;
    }
    return json(body);
  }
}

export async function newStwrd(
  extra: Record<string, unknown> = {},
  tuning?: RefreshTuning,
): Promise<{ idp: InProcessIdp; stwrd: StwrdCore }> {
  const idp = await InProcessIdp.create();
  const stwrd = new StwrdCore({
    issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, baseUrl: BASE_URL, cookieSecret: COOKIE_SECRET,
    scope: "openid profile email offline_access org", fetch: idp.fetch as never, ...extra,
  }, tuning);
  return { idp, stwrd };
}
