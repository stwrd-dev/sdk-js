/**
 * `Stwrd`: cookie sealing, CSRF, and session resolution against a plain
 * `MemoryStore` — no HTTP needed for any of this.
 */

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { Stwrd, createStwrd } from "../../src/client.js";
import { ConfigError } from "@stwrd-auth/core/config";
import { DuplicateEventError } from "../../src/webhooks.js";
import { BASE_URL, CLIENT_ID, CLIENT_SECRET } from "./helpers.js";

const ISSUER = "https://auth.example.com";

function stwrd(overrides: Partial<Parameters<typeof createStwrd>[0]> = {}): Stwrd {
  return createStwrd({
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: BASE_URL,
    cookieSecret: "x".repeat(32),
    webhookSecret: "whsec-vector-compartido-stwrd",
    ...overrides,
  });
}

describe("seal / unseal", () => {
  it("round-trips a value", () => {
    const instance = stwrd();
    const value = { sid: "abc123" };
    expect(instance.unseal(instance.seal(value))).toEqual(value);
  });

  it("rejects a tampered cookie", () => {
    const instance = stwrd();
    const sealed = instance.seal({ sid: "abc123" });
    const separator = sealed.lastIndexOf(".");
    const tampered = `${sealed.slice(0, separator)}x.${sealed.slice(separator + 1)}`;
    expect(instance.unseal(tampered)).toBeNull();
  });

  it("rejects garbage", () => {
    const instance = stwrd();
    expect(instance.unseal(null)).toBeNull();
    expect(instance.unseal("")).toBeNull();
    expect(instance.unseal("not-a-sealed-value")).toBeNull();
  });

  it("rejects a cookie signed by a different secret", () => {
    const other = stwrd({ cookieSecret: "y".repeat(32) });
    const sealed = other.seal({ sid: "abc123" });
    const first = stwrd();
    expect(first.unseal(sealed)).toBeNull();
  });
});

describe("csrf", () => {
  it("is deterministic for the same session id", () => {
    const instance = stwrd();
    expect(instance.csrf("session-1")).toBe(instance.csrf("session-1"));
    expect(instance.csrf("session-1")).not.toBe(instance.csrf("session-2"));
  });
});

function session(instance: Stwrd, options: { accessExpiresInS: number; sessionExpiresInS?: number }) {
  const now = Date.now() / 1000;
  return {
    id: "s1",
    sidIdp: "sid1",
    sub: "usr_1",
    claims: { sub: "usr_1", email: "a@b.test" },
    tokens: {
      access_token: "at",
      id_token: "idt",
      token_type: "Bearer",
      expiresAt: now + options.accessExpiresInS,
    },
    expiresAt: now + (options.sessionExpiresInS ?? 3600),
    accessExpiresAt: now + options.accessExpiresInS,
  };
}

describe("resolveSession", () => {
  it("returns a live session", async () => {
    const instance = stwrd();
    const s = session(instance, { accessExpiresInS: 3600 });
    await instance.sessions.set(s);
    const cookie = instance.seal({ sid: s.id });

    const resolved = await instance.resolveSession(cookie);
    expect(resolved?.id).toBe(s.id);
  });

  it("ends the session when the access token expired and there is no refresh", async () => {
    // Without offline_access there is no renewal: with no refresh_token on the
    // session, the credential's lifetime is still the access token's. The
    // renewal branch lives in refresh.test.ts.
    const instance = stwrd();
    const s = session(instance, { accessExpiresInS: -1 });
    await instance.sessions.set(s);
    const cookie = instance.seal({ sid: s.id });

    expect(await instance.resolveSession(cookie)).toBeNull();
    expect(await instance.sessions.get(s.id)).toBeNull(); // the local session actually ended
  });

  it("ends the session when the session itself expired", async () => {
    const instance = stwrd();
    const s = session(instance, { accessExpiresInS: 3600, sessionExpiresInS: -1 });
    await instance.sessions.set(s);
    const cookie = instance.seal({ sid: s.id });

    expect(await instance.resolveSession(cookie)).toBeNull();
  });

  it("returns null with no cookie", async () => {
    const instance = stwrd();
    expect(await instance.resolveSession(null)).toBeNull();
  });
});

describe("sessionFromCookie", () => {
  it("does not end an expired-access-token session", async () => {
    // A raw read of the store, without renewing and, by the same token,
    // without the side effect of ending the session either.
    const instance = stwrd();
    const s = session(instance, { accessExpiresInS: -1 });
    await instance.sessions.set(s);
    const cookie = instance.seal({ sid: s.id });

    const raw = await instance.sessionFromCookie(cookie);
    expect(raw?.id).toBe(s.id);
    expect(await instance.sessions.get(s.id)).not.toBeNull(); // still there: no side effect
  });
});

describe("verifyWebhook", () => {
  it("without a configured secret raises ConfigError", () => {
    const instance = stwrd({ webhookSecret: "" });
    expect(() => instance.verifyWebhook(Buffer.from("{}"), {})).toThrow(ConfigError);
  });

  it("dedups against seenWebhookIds", () => {
    const instance = stwrd();
    const body = Buffer.from(
      JSON.stringify({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", type: "user.created", api_version: "v1", created_at: "2026-01-01T00:00:00Z", data: {} }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signed = Buffer.concat([Buffer.from(`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.${timestamp}.`), body]);
    const signature =
      "v1," + createHmac("sha256", instance.config.webhookSecret).update(signed).digest("base64");
    const headers = { "webhook-id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "webhook-timestamp": timestamp, "webhook-signature": signature };

    const first = instance.verifyWebhook(body, headers);
    expect(first.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(() => instance.verifyWebhook(body, headers)).toThrow(DuplicateEventError);
  });
});

describe("sessionIdForSid", () => {
  it("is stable for the same sid, and differs across sids", () => {
    // The property that makes back-channel logout useful: the notice
    // carries the IdP's `sid`, and the store is keyed by the BFF's own id
    // — so the id has to be derivable from `sid`, or the notice arrives and
    // kills nothing.
    const instance = stwrd();
    const first = instance.sessionIdForSid("a-session-at-the-idp");
    expect(first).toBe(instance.sessionIdForSid("a-session-at-the-idp"));
    expect(first).not.toBe(instance.sessionIdForSid("another-session"));
    // Keyed: a leaked `sid` does not reveal the local id.
    expect(first.includes("a-session-at-the-idp")).toBe(false);
  });

  it("a different cookie secret derives a different session id", () => {
    // Rotating the secret reassigns the derivation for free — the same
    // rotation already invalidated every sealed cookie, so those sessions
    // were unreachable anyway.
    const a = stwrd({ cookieSecret: "a".repeat(32) });
    const b = stwrd({ cookieSecret: "b".repeat(32) });
    expect(a.sessionIdForSid("s")).not.toBe(b.sessionIdForSid("s"));
  });
});
