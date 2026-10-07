import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The tests import `@stwrd-auth/core` the way a consumer does, through its
// `exports` (the built `dist`): build the workspace before running them. They
// run inside workerd with `nodejs_compat` and the Durable Object binding of
// `wrangler.test.jsonc`, the runtime the adapter is for. There is no switch to
// skip that project: if the workerd binary is missing, `vitest list` fails
// and the test run fails.
export default defineConfig({
  test: {
    projects: [
      {
        // The smoke test: `wrangler deploy --dry-run` on a Worker that uses the package.
        extends: true,
        test: { name: "node", environment: "node", include: ["tests/node/**/*.test.ts"] },
      },
      {
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: { name: "workerd", include: ["tests/workerd/**/*.test.ts"] },
      },
    ],
  },
});
