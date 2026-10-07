import { defineConfig } from "vitest/config";

// The tests import `@stwrd-auth/core` the way a consumer does, through its
// `exports` (the built `dist`): build the workspace before running them.
export default defineConfig({});
