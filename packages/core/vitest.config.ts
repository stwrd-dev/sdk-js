import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The core has to behave the same on Node and on workerd (Cloudflare Workers
// with `nodejs_compat`). Two projects, one per runtime; `tests/both` runs in
// each. There is deliberately no switch to skip the workerd project: if the
// workerd binary is missing, `vitest list` fails and the test run fails.
const include = (runtime: string) => [`tests/${runtime}/**/*.test.ts`, "tests/both/**/*.test.ts"];
const globalSetup = ["./tests/support/global-setup.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "node", environment: "node", include: ["tests/node/**/*.test.ts", "tests/both/**/*.test.ts"], globalSetup },
      },
      {
        plugins: [
          cloudflareTest({ miniflare: { compatibilityDate: "2026-08-22", compatibilityFlags: ["nodejs_compat"] } }),
        ],
        test: { name: "workerd", include: include("workerd"), globalSetup },
      },
    ],
  },
});
