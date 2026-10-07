import { describe, expect, it } from "vitest";
import { safeTarget } from "../../src/index";

// Every SDK confines `return_to` identically: the same table is used by the
// core's handler tests.
const RETURN_TO_TABLE: Array<[string, string]> = [
  ["/private", "/private"],
  ["/", "/"],
  ["/a/b?c=1&d=2", "/a/b?c=1&d=2"],
  ["/a#frag", "/a#frag"],
  ["/@evil", "/@evil"],
  ["https://evil.example/", "/"],
  ["http://evil.example", "/"],
  ["//evil.example", "/"],
  ["//evil.example/path", "/"],
  ["/\\evil.example", "/"],
  ["javascript:alert(1)", "/"],
  ["@evil.example", "/"],
  ["evil.example", "/"],
  ["private", "/"],
  ["", "/"],
  // A control character: a URL parser drops a tab or a line break, so these
  // would resolve to `//evil.example`.
  ["/\t/evil.example", "/"],
  ["/\n/evil.example", "/"],
  ["/\r\n/evil.example", "/"],
  ["/a\tb", "/"],
  ["/a\u0000b", "/"],
  ["/a\u007fb", "/"],
];

describe("safeTarget confines return_to to this origin", () => {
  it.each(RETURN_TO_TABLE)("%j → %j", (candidate, expected) => {
    expect(safeTarget(candidate)).toBe(expected);
  });
});
