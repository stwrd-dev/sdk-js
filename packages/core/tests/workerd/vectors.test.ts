// workerd must give the bytes Node gives. Node computed the reference
// (`global-setup.ts`) from the same `VECTOR_CASES` table that workerd runs
// here: nothing is typed in by hand, so a vector cannot be "corrected" to
// whatever the code returns.
import { inject, describe, expect, it } from "vitest";

import { VECTOR_CASES } from "../support/vectorCases.js";

describe("cross-runtime vectors", () => {
  const reference = inject("vectors");

  it("the reference has exactly the table's cases", () => {
    expect(Object.keys(reference).sort()).toEqual(VECTOR_CASES.map((vector) => vector.name).sort());
  });

  it.each(VECTOR_CASES.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    expect(vector.run()).toEqual(reference[vector.name]);
  });
});
