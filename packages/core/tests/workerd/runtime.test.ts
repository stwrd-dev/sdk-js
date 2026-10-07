// "Runs in workerd": the whole workerd project would be a lie if this file
// were executed by Node. It pins the runtime detector and checks that the
// core exposes the same exported names under workerd as under Node.
import { inject, describe, expect, it } from "vitest";

import { IS_WORKERD, RUNTIME } from "../support/runtime.js";

describe("the workerd project runs in workerd", () => {
  it("is Cloudflare's runtime, not Node", () => {
    expect(navigator.userAgent).toBe("Cloudflare-Workers");
    expect("WebSocketPair" in globalThis).toBe(true);
    expect(IS_WORKERD).toBe(true);
    expect(RUNTIME).toBe("workerd");
  });

  it("has node:crypto and Buffer through nodejs_compat", async () => {
    const { createHmac } = await import("node:crypto");
    expect(createHmac("sha256", "k").update("d").digest("base64url")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from("-__-AAE", "base64url").length).toBe(5);
  });
});

describe("the core exports the same names under workerd as under Node", () => {
  const modules = import.meta.glob("../../src/**/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;
  const reference = inject("exportNames");

  it("sees the same set of modules", () => {
    expect(Object.keys(modules).sort()).toEqual(Object.keys(reference).sort());
    expect(Object.keys(reference).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(reference).sort())("%s", (path) => {
    expect(Object.keys(modules[path]).sort()).toEqual(reference[path]);
  });
});
