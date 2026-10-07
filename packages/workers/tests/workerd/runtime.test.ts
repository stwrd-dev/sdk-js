// The suite of this package is only worth something inside workerd with
// `nodejs_compat`: this pins that it runs there, and that the package loads.
import { describe, expect, it } from "vitest";

import { VERSION } from "../../src/index.js";

describe("the tests of @stwrd-auth/workers run in workerd", () => {
  it("is Cloudflare's runtime, not Node", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
    expect("WebSocketPair" in globalThis).toBe(true);
  });

  it("has node:crypto and Buffer through nodejs_compat", async () => {
    const { createHmac } = await import("node:crypto");
    expect(createHmac("sha256", "k").update("d").digest("base64url")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from("-__-AAE", "base64url").length).toBe(5);
  });

  it("loads the package entry point", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
