import { describe, expect, it } from "vitest";

import { ConfigError } from "@stwrd-auth/core/config";
import { SESSION_KEYS_ENV, parseSessionKeys } from "../../src/sessionKeys.js";

const key = (fill: number) => Buffer.alloc(32, fill).toString("base64url");
const K1 = key(1);
const K2 = key(2);

describe("STWRD_SESSION_KEYS", () => {
  it("the first entry encrypts and every entry decrypts", async () => {
    const ring = parseSessionKeys(`new:${K2}, old:${K1}`);
    expect(ring.current).toBe("new");
    expect(Object.keys(ring.keys).sort()).toEqual(["new", "old"]);
    const sealedWithOld = await parseSessionKeys(`old:${K1}`).encrypt("session");
    expect(await ring.decrypt(sealedWithOld)).toBe("session");
    expect(await parseSessionKeys(`old:${K1}`).decrypt(await ring.encrypt("x")).catch(() => "unreadable")).toBe("unreadable");
  });

  it("accepts one key, with the ids a JWE header can carry", () => {
    expect(parseSessionKeys(`2026-10.a_b:${K1}`).current).toBe("2026-10.a_b");
  });

  it("an id such as __proto__ is a key id, not a prototype", () => {
    const ring = parseSessionKeys(`__proto__:${K1}`);
    expect(Object.hasOwn(ring.keys, "__proto__")).toBe(true);
    expect(ring.current).toBe("__proto__");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["not a string", 42],
    ["empty", ""],
    ["blank", "  "],
    ["an entry with no colon", K1],
    ["an empty id", `:${K1}`],
    ["an id with a forbidden character", `a b:${K1}`],
    ["an id of 65 characters", `${"a".repeat(65)}:${K1}`],
    ["a trailing comma", `a:${K1},`],
    ["a repeated id", `a:${K1},a:${K2}`],
    ["a key of 31 bytes", `a:${Buffer.alloc(31, 1).toString("base64url")}`],
    ["a key of 33 bytes", `a:${Buffer.alloc(33, 1).toString("base64url")}`],
    ["a key with padding", `a:${Buffer.alloc(32, 1).toString("base64")}`],
    ["a key in plain base64", `a:${Buffer.from([0xfb, 0xff, ...Array(30).fill(1)]).toString("base64")}`],
    ["a key with a stray character", `a:${K1.slice(0, -1)}!`],
    ["a key that is not base64url at all", "a:not a key"],
    ["a bad second entry", `a:${K1},b:short`],
  ])("refuses %s", (_label, value) => {
    expect(() => parseSessionKeys(value)).toThrow(ConfigError);
  });

  it("never puts a key in the error", () => {
    for (const value of [`a:${K1},a:${K2}`, `a:${K1.slice(0, -1)}!`, `a:${Buffer.alloc(31, 7).toString("base64url")}`]) {
      try {
        parseSessionKeys(value);
        expect.unreachable();
      } catch (error) {
        const message = (error as Error).message;
        for (const secret of [K1, K2, Buffer.alloc(31, 7).toString("base64url")]) expect(message).not.toContain(secret);
        expect(message).toContain(SESSION_KEYS_ENV);
      }
    }
  });
});
