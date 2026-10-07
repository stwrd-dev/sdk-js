/**
 * `sign` / `unsign` / `csrfToken`: the raw HMAC primitives `Stwrd.seal`/
 * `.unseal`/`.csrf` build on.
 */

import { describe, expect, it } from "vitest";

import { csrfToken, sign, unsign } from "@stwrd-auth/core/crypto";

describe("sign / unsign", () => {
  it("unsign verifies what sign produced", () => {
    const signature = sign("a-secret-at-least-this-long", "payload");
    expect(unsign("a-secret-at-least-this-long", "payload", signature)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const signature = sign("a-secret-at-least-this-long", "payload");
    expect(unsign("a-secret-at-least-this-long", "payload", `${signature}x`)).toBe(false);
  });

  it("rejects a signature computed under a different secret", () => {
    const signature = sign("secret-one-that-is-long-enough", "payload");
    expect(unsign("secret-two-that-is-long-enough", "payload", signature)).toBe(false);
  });

  it("is deterministic for the same input", () => {
    expect(sign("secret-value-long-enough", "x")).toBe(sign("secret-value-long-enough", "x"));
  });
});

describe("csrfToken", () => {
  it("is deterministic for the same session id", () => {
    expect(csrfToken("s", "session-1")).toBe(csrfToken("s", "session-1"));
    expect(csrfToken("s", "session-1")).not.toBe(csrfToken("s", "session-2"));
  });
});
