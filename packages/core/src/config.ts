/**
 * Configuration resolution shared by the stwrd JavaScript SDKs.
 *
 * `STWRD_COOKIE_SECRET` must have at least 32 characters, checked when the
 * configuration is built: it is the HMAC key of the session cookie, and a
 * deployment with a short key has to fail to start rather than start quietly.
 * Every other rule here exists for the same reason: a misconfigured
 * integration must fail at construction time, not three requests later with a
 * confusing 500.
 *
 * `configFromEnv` only reads the environment into a partial options bag;
 * `resolveConfig` validates it and fills the defaults, for either an
 * environment-sourced or a hand-built options object. `Stwrd.fromEnv()`
 * composes the two.
 */

// The default scope. `org` is deliberately absent: it must be requested
// explicitly, and the application must be allowed to use it.
export const DEFAULT_SCOPE = "openid profile email offline_access";

export const DEFAULT_PREFIX = "/auth";
// `__Host-` cookies: the prefix forbids the `Domain` attribute, so a browser
// never sends one tenant's cookie to another tenant's host.
export const DEFAULT_SESSION_COOKIE = "__Host-stwrd_session";
export const DEFAULT_TX_COOKIE = "__Host-stwrd_tx";
export const DEFAULT_SESSION_TTL_S = 8 * 3600;
export const DEFAULT_TRANSACTION_TTL_S = 600;

/** Minimum length of the HMAC key that seals the session cookie. */
export const COOKIE_SECRET_MIN_LEN = 32;

/** `STWRD_*` — deliberately the same names the Python SDK reads, so an app
 * can switch language without touching its `.env`. */
export const ENV_PREFIX = "STWRD_";

export const REQUIRED_ENV = ["ISSUER", "CLIENT_ID", "CLIENT_SECRET", "BASE_URL", "COOKIE_SECRET"] as const;

/** The SDK refuses to build a config from this input. A dedicated class, not
 * a bare `Error`: an app that wants to catch "my own config is wrong"
 * separately from "the IdP rejected something" needs the two to be
 * distinguishable types (`OidcError` is the other one). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** What `createStwrd`/`Stwrd.fromEnv` accept. */
export interface StwrdConfigOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  cookieSecret: string;

  scope?: string;
  webhookSecret?: string;
  prefix?: string;
  sessionCookie?: string;
  txCookie?: string;
  sessionTtlS?: number;
  transactionTtlS?: number;
  cookieSecure?: boolean;
  postLoginRedirect?: string;
  postLogoutRedirect?: string;
}

/** What `OidcClient` needs, and nothing more. */
export interface OidcParams {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

/** The resolved, validated configuration that `Stwrd.config` exposes. */
export interface ResolvedConfig extends Required<StwrdConfigOptions> {
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
  readonly accountUrl: string;
  oidc(): OidcParams;
  replace(changes: Partial<StwrdConfigOptions>): ResolvedConfig;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

class Config implements ResolvedConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl: string;
  readonly cookieSecret: string;
  readonly scope: string;
  readonly webhookSecret: string;
  readonly prefix: string;
  readonly sessionCookie: string;
  readonly txCookie: string;
  readonly sessionTtlS: number;
  readonly transactionTtlS: number;
  readonly cookieSecure: boolean;
  readonly postLoginRedirect: string;
  readonly postLogoutRedirect: string;

  constructor(options: StwrdConfigOptions) {
    this.issuer = options.issuer;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.baseUrl = options.baseUrl;
    this.cookieSecret = options.cookieSecret;
    this.scope = options.scope ?? DEFAULT_SCOPE;
    this.webhookSecret = options.webhookSecret ?? "";
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.sessionCookie = options.sessionCookie ?? DEFAULT_SESSION_COOKIE;
    this.txCookie = options.txCookie ?? DEFAULT_TX_COOKIE;
    this.sessionTtlS = options.sessionTtlS ?? DEFAULT_SESSION_TTL_S;
    this.transactionTtlS = options.transactionTtlS ?? DEFAULT_TRANSACTION_TTL_S;
    this.cookieSecure = options.cookieSecure ?? true;
    this.postLoginRedirect = options.postLoginRedirect ?? "/";
    this.postLogoutRedirect = options.postLogoutRedirect ?? "/";

    const missing = (
      [
        ["issuer", this.issuer],
        ["clientId", this.clientId],
        ["clientSecret", this.clientSecret],
        ["baseUrl", this.baseUrl],
        ["cookieSecret", this.cookieSecret],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new ConfigError(`Missing required fields in the configuration: ${missing.join(", ")}`);
    }
    if (this.cookieSecret.length < COOKIE_SECRET_MIN_LEN) {
      throw new ConfigError(
        `cookieSecret has ${this.cookieSecret.length} characters and needs at least ` +
          `${COOKIE_SECRET_MIN_LEN}: it is the session cookie's HMAC key, and a short ` +
          "key must stop startup, not start silently.",
      );
    }
    // `Number.isInteger` rejects NaN and ±Infinity, which `<= 0` lets through
    // (`NaN <= 0` is false): a NaN TTL would make every session never expire.
    if (
      !Number.isInteger(this.sessionTtlS) ||
      !Number.isInteger(this.transactionTtlS) ||
      this.sessionTtlS <= 0 ||
      this.transactionTtlS <= 0
    ) {
      throw new ConfigError("sessionTtlS and transactionTtlS must be positive integers.");
    }
    if (!this.prefix.startsWith("/")) {
      throw new ConfigError(`prefix must start with "/": ${this.prefix}`);
    }
  }

  get redirectUri(): string {
    return `${stripTrailingSlash(this.baseUrl)}${this.prefix}/callback`;
  }

  get postLogoutRedirectUri(): string {
    return `${stripTrailingSlash(this.baseUrl)}${this.postLogoutRedirect}`;
  }

  get accountUrl(): string {
    // The person's account page, as reported in `GET /auth/session`.
    return `${stripTrailingSlash(this.issuer)}/me`;
  }

  oidc(): OidcParams {
    return {
      issuer: this.issuer,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
      scope: this.scope,
    };
  }

  replace(changes: Partial<StwrdConfigOptions>): ResolvedConfig {
    return new Config({ ...this.toOptions(), ...changes });
  }

  private toOptions(): StwrdConfigOptions {
    return {
      issuer: this.issuer,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      baseUrl: this.baseUrl,
      cookieSecret: this.cookieSecret,
      scope: this.scope,
      webhookSecret: this.webhookSecret,
      prefix: this.prefix,
      sessionCookie: this.sessionCookie,
      txCookie: this.txCookie,
      sessionTtlS: this.sessionTtlS,
      transactionTtlS: this.transactionTtlS,
      cookieSecure: this.cookieSecure,
      postLoginRedirect: this.postLoginRedirect,
      postLogoutRedirect: this.postLogoutRedirect,
    };
  }
}

/** Validates and fills in defaults. Throws `ConfigError`, fail-closed, never
 * a default that lets the process start half-configured. */
export function resolveConfig(options: StwrdConfigOptions): ResolvedConfig {
  return new Config(options);
}

// env name -> option field. `REQUIRED_ENV` names the five with no default;
// the rest only override when present.
const FIELD_BY_ENV: Record<string, keyof StwrdConfigOptions> = {
  ISSUER: "issuer",
  CLIENT_ID: "clientId",
  CLIENT_SECRET: "clientSecret",
  BASE_URL: "baseUrl",
  COOKIE_SECRET: "cookieSecret",
  WEBHOOK_SECRET: "webhookSecret",
  SCOPE: "scope",
  PREFIX: "prefix",
  POST_LOGIN_REDIRECT: "postLoginRedirect",
  POST_LOGOUT_REDIRECT: "postLogoutRedirect",
};

/** The environment as the core sees it: a bag of names to values. Node hands
 * over `process.env`; Workers hand over their `env` binding object, which
 * carries objects (bindings) next to the plain-string variables. The core
 * never reads a global environment of its own. */
export type EnvLike = Readonly<Record<string, unknown>>;

// A variable is a string; wrangler `vars` also allow a bare number or boolean,
// which read the same. Anything else under an `STWRD_*` name (a binding, an
// object, `null`) is a misconfiguration and fails closed.
function envString(name: string, raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  throw new ConfigError(`${name} must be a string, not ${raw === null ? "null" : typeof raw}.`);
}

/** Reads `STWRD_*` (or `envPrefix`-prefixed) variables into a partial
 * options bag — no validation, no defaults filled in beyond what the
 * environment itself carries. `resolveConfig` is what turns this (merged
 * with any caller overrides) into a validated config. There is no default
 * `env`: the Node adapter passes `process.env`. */
export function configFromEnv(
  env: EnvLike,
  envPrefix: string = ENV_PREFIX,
): Partial<StwrdConfigOptions> {
  const values: Partial<StwrdConfigOptions> = {};
  for (const [envName, field] of Object.entries(FIELD_BY_ENV)) {
    const raw = envString(`${envPrefix}${envName}`, env[`${envPrefix}${envName}`]);
    if (raw !== undefined) {
      (values as Record<string, unknown>)[field] = raw;
    }
  }
  const sessionTtl = envString(`${envPrefix}SESSION_TTL_S`, env[`${envPrefix}SESSION_TTL_S`]);
  if (sessionTtl !== undefined) {
    // Strict: `parseInt` would turn "abc" into NaN and read "12abc" as 12.
    // A value that is not a plain integer is a typo, and invalid config
    // fails closed.
    if (!/^[+-]?\d+$/.test(sessionTtl.trim())) {
      throw new ConfigError(
        `${envPrefix}SESSION_TTL_S must be an integer number of seconds, not ${JSON.stringify(sessionTtl)}.`,
      );
    }
    values.sessionTtlS = Number(sessionTtl.trim());
  }
  const cookieSecure = envString(`${envPrefix}COOKIE_SECURE`, env[`${envPrefix}COOKIE_SECURE`]);
  if (cookieSecure !== undefined) {
    values.cookieSecure = !["0", "false", "no", ""].includes(cookieSecure.trim().toLowerCase());
  }
  return values;
}

/** `configFromEnv` + `resolveConfig`, with `overrides` winning over the
 * environment. Fails closed (`ConfigError`) if a required variable is
 * missing from both. */
export function stwrdConfigFromEnv(
  env: EnvLike,
  envPrefix: string = ENV_PREFIX,
  overrides: Partial<StwrdConfigOptions> = {},
): ResolvedConfig {
  const fromEnv = configFromEnv(env, envPrefix);
  const merged = { ...fromEnv, ...overrides };
  const missing = REQUIRED_ENV.filter((name) => !merged[FIELD_BY_ENV[name]]);
  if (missing.length > 0) {
    throw new ConfigError(
      "Missing required environment variables: " +
        missing.map((name) => `${envPrefix}${name}`).join(", "),
    );
  }
  return resolveConfig(merged as StwrdConfigOptions);
}
