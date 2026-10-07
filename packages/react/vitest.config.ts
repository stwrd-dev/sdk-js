import { defineConfig } from "vitest/config";

// The package is tested without a network: everything runs against a mocked
// `/auth/session`, with vitest, jsdom and testing-library. `environment:
// "jsdom"` is what makes `document`/`window` exist for
// `@testing-library/react`.
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});
