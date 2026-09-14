import { describe, expect, it } from "vitest";

import { isUniqueConstraintError } from "../src/errors.ts";

describe("Prisma error utilities", () => {
  it("recognizes only unique constraint errors", () => {
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isUniqueConstraintError({ code: "P2003" })).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});
