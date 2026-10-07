// Adds the `toBeInTheDocument()`-style matchers `@testing-library/react`'s
// own docs assume, and cleans up the rendered tree between tests so one
// component left mounted cannot leak into the next test's queries.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
