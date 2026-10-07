// `main` of `wrangler.test.jsonc`: exports the Durable Object class the
// binding names, and a handler for the tests that go through `fetch`.
export { StwrdSessionObject } from "../../src/sessionObject.js";

export default {
  async fetch(): Promise<Response> {
    return new Response("stwrd-workers test worker");
  },
};
