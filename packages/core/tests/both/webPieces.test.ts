// The small pieces under the handler, on both runtimes: the exact `Set-Cookie`
// shape (what Express 4 produced), `Location` encoding, the body reader's
// ceilings, and the back-channel sink's order of operations.
import { describe, expect, it } from "vitest";

import { MemoryBackChannelSink } from "../../src/backchannel.js";
import { MemoryStore } from "../../src/sessions.js";
import { BodyInvalid, BodyTooLarge, readBytes, readFormBody } from "../../src/web/body.js";
import { safeTarget } from "../../src/web/access.js";
import { clearedCookieHeader, parseCookies, readRequestCookie, setCookieHeader } from "../../src/web/cookies.js";
import { encodeUrl, jsonResponse, redirectResponse } from "../../src/web/response.js";

describe("Set-Cookie, in the exact shape Express 4 produced", () => {
  const NOW = Date.UTC(2026, 9, 7, 2, 33, 25);

  it.each([
    ["a session cookie", "__Host-s", "abc.def-_", { maxAgeS: 28800, secure: true }, "__Host-s=abc.def-_; Max-Age=28800; Path=/; Expires=Wed, 07 Oct 2026 10:33:25 GMT; HttpOnly; Secure; SameSite=Lax"],
    ["a plain-http cookie", "__Host-t", "v", { maxAgeS: 600, secure: false }, "__Host-t=v; Max-Age=600; Path=/; Expires=Wed, 07 Oct 2026 02:43:25 GMT; HttpOnly; SameSite=Lax"],
    ["a value that needs escaping", "n", "a b;c=ñ", { maxAgeS: 1, secure: true }, "n=a%20b%3Bc%3D%C3%B1; Max-Age=1; Path=/; Expires=Wed, 07 Oct 2026 02:33:26 GMT; HttpOnly; Secure; SameSite=Lax"],
  ])("%s", (_label, name, value, options, expected) => {
    expect(setCookieHeader(name, value, { ...options, nowMs: NOW })).toBe(expected);
  });

  // 2026-10-07, on purpose not Express 4's `clearCookie`: a browser refuses a
  // deletion of a `__Host-` cookie that is not `Secure`, so the session cookie
  // outlived the sign-out. The deletion carries the attributes of the cookie,
  // `Secure` included, and `Max-Age=0` next to the epoch `Expires`.
  it.each([
    ["https", true, "__Host-s=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax"],
    ["plain http", false, "__Host-s=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"],
  ])("a deletion over %s carries the cookie's attributes, Secure and Max-Age=0", (_label, secure, expected) => {
    expect(clearedCookieHeader("__Host-s", { secure })).toBe(expected);
  });

  it.each(["", "a b", "a;b", "a=b", "ñ"])("refuses the cookie name %j", (name) => {
    expect(() => setCookieHeader(name, "v", { maxAgeS: 1, secure: true })).toThrow(TypeError);
    expect(() => clearedCookieHeader(name, { secure: true })).toThrow(TypeError);
  });

  it("a response keeps each cookie as its own header", () => {
    const response = redirectResponse("/x", ["a=1", "b=2"]);
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(jsonResponse({}, 200, {}, ["c=3"]).headers.getSetCookie()).toEqual(["c=3"]);
  });

  it("reads a cookie off the request headers", () => {
    expect(readRequestCookie(new Headers({ cookie: "a=1; __Host-s=abc" }), "__Host-s")).toBe("abc");
    expect(readRequestCookie(new Headers(), "__Host-s")).toBeUndefined();
    expect(parseCookies("a=1")).toEqual({ a: "1" });
  });
});

describe("Location is encoded the way a header can carry it", () => {
  it.each([
    ["a plain path", "/a/b?c=1&d=2#f", "/a/b?c=1&d=2#f"],
    ["a space and non-ASCII", "/café ñ", "/caf%C3%A9%20%C3%B1"],
    ["an escape that is already valid is left alone", "/a%20b", "/a%20b"],
    ["a stray percent is escaped", "/100%", "/100%25"],
    ["a lone surrogate becomes the replacement character", "/\uD800x", "/%EF%BF%BDx"],
  ])("%s", (_label, input, expected) => {
    expect(encodeUrl(input)).toBe(expected);
    expect(redirectResponse(input).headers.get("location")).toBe(expected);
  });

  it("is a bare 303 with no body", async () => {
    const response = redirectResponse("/x");
    expect(response.status).toBe(303);
    expect(await response.text()).toBe("");
  });
});

describe("the body reader", () => {
  const post = (body: NonNullable<RequestInit["body"]> | null, headers: Record<string, string> = {}) =>
    new Request("https://app.example/x", { method: "POST", body, headers });

  it("returns what it reads, and nothing for no body", async () => {
    expect(new TextDecoder().decode(await readBytes(post("hello"), 10))).toBe("hello");
    expect((await readBytes(post(null), 10)).byteLength).toBe(0);
  });

  it("refuses one byte over the ceiling and takes exactly the ceiling", async () => {
    expect((await readBytes(post("a".repeat(10)), 10)).byteLength).toBe(10);
    await expect(readBytes(post("a".repeat(11)), 10)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it("refuses by the declared length and cancels the stream", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
    const request = new Request("https://app.example/x", { method: "POST", body, headers: { "content-length": "999" }, duplex: "half" } as RequestInit);
    await expect(readBytes(request, 10)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(cancelled).toBe(true);
  });

  it("reads a consumed body as empty", async () => {
    const request = post("abc");
    await request.arrayBuffer();
    expect((await readBytes(request, 10)).byteLength).toBe(0);
  });

  const FORM = { "content-type": "application/x-www-form-urlencoded" };
  const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

  it.each([
    ["a form", post("a=1&b=%C3%B1&b=2&c=", FORM), {}, { a: "1", b: ["ñ", "2"], c: "" }],
    ["JSON when asked for", post('{"a":1}', JSON_TYPE), { json: true }, { a: 1 }],
    ["JSON is empty when not asked for", post('{"a":1}', JSON_TYPE), {}, {}],
    ["an empty JSON body", post("  ", JSON_TYPE), { json: true }, {}],
    ["another content type", post("a=1", { "content-type": "text/plain" }), { json: true }, {}],
    ["no content type", post("a=1"), { json: true }, {}],
  ])("parses %s", async (_label, request, options, expected) => {
    expect(await readFormBody(request, options)).toEqual(expected);
  });

  it("refuses more than 1000 fields (what Express and the Python SDK refuse), takes exactly 1000", async () => {
    const fields = (n: number) => Array.from({ length: n }, (_, i) => `k${i}=v`).join("&");
    expect(Object.keys(await readFormBody(post(fields(1000), FORM)))).toHaveLength(1000);
    await expect(readFormBody(post(fields(1001), FORM))).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it("a body of one repeated key stays linear and refused", async () => {
    // 100 KiB of `k&`: 51200 fields. It froze the process for ~21 s when each
    // repeat rebuilt the array; it has to be a 413 and quick.
    const started = Date.now();
    await expect(readFormBody(post("k&".repeat(51200), FORM))).rejects.toBeInstanceOf(BodyTooLarge);
    // Under the field ceiling a repeated key still collects every value.
    const some = await readFormBody(post("k=1&".repeat(999) + "k=2", FORM));
    expect((some.k as string[]).length).toBe(1000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it.each([["not json", "{nope"], ["a JSON string", '"x"'], ["JSON null", "null"]])("refuses %s with BodyInvalid", async (_label, text) => {
    await expect(readFormBody(post(text, JSON_TYPE), { json: true })).rejects.toBeInstanceOf(BodyInvalid);
  });
});

describe("the back-channel sink deletes first and marks second", () => {
  const stored = (id: string) => ({
    id, sidIdp: "s", sub: "u", claims: { sub: "u" }, tokens: { access_token: "a", id_token: "i", token_type: "Bearer", expiresAt: 9e9 },
    expiresAt: 9e9, accessExpiresAt: 9e9,
  });
  const FUTURE = Date.now() / 1000 + 60;

  it("ends the session and refuses the same jti afterwards", async () => {
    const store = new MemoryStore();
    await store.set(stored("s1"));
    const sink = new MemoryBackChannelSink(store);
    expect(await sink.terminate("s1", "j", FUTURE)).toBe("terminated");
    expect(await store.get("s1")).toBeNull();
    expect(await sink.terminate("s1", "j", FUTURE)).toBe("replay");
  });

  it("a deletion that fails marks nothing: the retry ends the session", async () => {
    const store = new MemoryStore();
    await store.set(stored("s1"));
    const real = store.delete.bind(store);
    let failures = 1;
    store.delete = async (id: string) => {
      if (failures-- > 0) throw new Error("store down");
      return real(id);
    };
    const sink = new MemoryBackChannelSink(store);
    await expect(sink.terminate("s1", "j", FUTURE)).rejects.toThrow("store down");
    expect(await store.get("s1")).not.toBeNull();
    expect(await sink.terminate("s1", "j", FUTURE)).toBe("terminated");
    expect(await store.get("s1")).toBeNull();
  });

  it("a replay deletes nothing", async () => {
    const store = new MemoryStore();
    const sink = new MemoryBackChannelSink(store);
    await sink.terminate(null, "j", FUTURE);
    await store.set(stored("s1"));
    expect(await sink.terminate("s1", "j", FUTURE)).toBe("replay");
    expect(await store.get("s1")).not.toBeNull();
  });

  it("forgets a jti once the notice could no longer pass validation", async () => {
    const sink = new MemoryBackChannelSink(new MemoryStore());
    expect(await sink.terminate(null, "j", Date.now() / 1000 - 1)).toBe("terminated");
    expect(await sink.terminate(null, "j", FUTURE)).toBe("terminated");
  });
});

describe("safeTarget keeps a redirect on this origin", () => {
  // The same table as the Express adapter tests, plus the control characters a URL parser drops: the target
  // `/\t/evil.example` resolved to `https://evil.example/`.
  it.each([
    ["/private", "/private"],
    ["/a/b?c=1&d=2#f", "/a/b?c=1&d=2#f"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example/", "/"],
    ["", "/"],
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/\r\n/evil.example", "/"],
    ["/a\tb", "/"],
    ["/a\u0000b", "/"],
    ["/a\u007fb", "/"],
  ])("%j -> %j", (candidate, expected) => {
    expect(safeTarget(candidate)).toBe(expected);
    // Whatever it returns resolves to this origin, never to another.
    expect(new URL(safeTarget(candidate), "https://app.example").origin).toBe("https://app.example");
  });
});
