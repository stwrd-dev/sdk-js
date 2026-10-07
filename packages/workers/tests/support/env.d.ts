// The bindings `wrangler.test.jsonc` declares, as `env` types them.
import type { StwrdSessionObject } from "../../src/sessionObject.js";

declare global {
  namespace Cloudflare {
    interface Env {
      STWRD_SESSIONS: DurableObjectNamespace<StwrdSessionObject>;
    }
  }
}
