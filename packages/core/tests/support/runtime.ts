// Which runtime a test is running on. `tests/workerd/runtime.test.ts` pins the
// detector itself, so a wrong answer here cannot turn a test vacuous.
export const IS_WORKERD: boolean =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers" && "WebSocketPair" in globalThis;

export const RUNTIME: "workerd" | "node" = IS_WORKERD ? "workerd" : "node";
