import { describe, expect, it } from "vitest";
import type { CellScalar } from "../src/cell-value.js";
import type { SkMcpExcelError } from "../src/errors.js";
import {
  classify,
  compareWithin,
  emptyCensus,
  evaluate,
  majorityKind,
  record,
  validateCondition,
  type Condition,
  type PredicateOptions,
} from "../src/predicate.js";

const loose: PredicateOptions = { caseSensitive: false, coerceText: false };

function hits(
  condition: Condition,
  cell: CellScalar,
  options = loose,
): boolean {
  return evaluate(condition, cell, options);
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return (error as SkMcpExcelError).code;
  }
  return "no-error";
}

describe("classify", () => {
  it("separates every kind", () => {
    expect(classify(5)).toBe("number");
    expect(classify("2026-01-15")).toBe("date");
    expect(classify("2026-01-15T09:30:00.000Z")).toBe("date");
    expect(classify("2026-01")).toBe("text");
    expect(classify("")).toBe("text");
    expect(classify(true)).toBe("boolean");
    expect(classify({ error: "#REF!" })).toBe("error");
    expect(classify(null)).toBe("empty");
  });
});

describe("kind is fixed by the operand", () => {
  it("does not cross number and text", () => {
    expect(hits({ column: "a", op: "eq", value: 5 }, "5")).toBe(false);
    expect(hits({ column: "a", op: "eq", value: "5" }, 5)).toBe(false);
    expect(hits({ column: "a", op: "eq", value: 5 }, 5)).toBe(true);
  });

  it("skips other kinds under an ordering operator", () => {
    for (const cell of [
      "text",
      true,
      { error: "#N/A" },
      null,
    ] as CellScalar[]) {
      expect(hits({ column: "a", op: "gt", value: 100 }, cell)).toBe(false);
    }
  });

  it("is not negation-complete across kinds", () => {
    const cell: CellScalar = "text";
    expect(hits({ column: "a", op: "gt", value: 5 }, cell)).toBe(false);
    expect(hits({ column: "a", op: "lte", value: 5 }, cell)).toBe(false);
  });
});

describe("dates", () => {
  it("compares lexically after expansion", () => {
    expect(
      hits(
        { column: "a", op: "gt", value: "2026-01-15" },
        "2026-01-16T09:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      compareWithin("date", "2026-01-15", "2026-01-15T00:00:00.000Z", true),
    ).toBe(0);
    expect(
      hits(
        { column: "a", op: "eq", value: "2026-01-15" },
        "2026-01-15T00:00:00.000Z",
      ),
    ).toBe(true);
  });
});

describe("text operators", () => {
  it("only look at text cells", () => {
    expect(hits({ column: "a", op: "contains", value: "1" }, 1234)).toBe(false);
    expect(hits({ column: "a", op: "contains", value: "23" }, "1234")).toBe(
      true,
    );
  });

  it("fold case and diacritics by default", () => {
    expect(
      hits({ column: "a", op: "contains", value: "istanbul" }, "İSTANBUL"),
    ).toBe(true);
    expect(hits({ column: "a", op: "eq", value: "sisli" }, "ŞİŞLİ")).toBe(true);
  });

  it("respect caseSensitive", () => {
    const strict = { caseSensitive: true, coerceText: false };
    expect(
      hits(
        { column: "a", op: "contains", value: "istanbul" },
        "İSTANBUL",
        strict,
      ),
    ).toBe(false);
  });
});

describe("blank and error operators", () => {
  it("keeps empty and empty string apart", () => {
    expect(hits({ column: "a", op: "isEmpty" }, null)).toBe(true);
    expect(hits({ column: "a", op: "isEmpty" }, "")).toBe(false);
    expect(hits({ column: "a", op: "isNotEmpty" }, "")).toBe(true);
  });

  it("matches error cells but not error-looking text", () => {
    expect(hits({ column: "a", op: "isError" }, { error: "#REF!" })).toBe(true);
    expect(hits({ column: "a", op: "isError" }, "#REF!")).toBe(false);
    expect(
      hits(
        { column: "a", op: "isError", value: "#DIV/0!" },
        { error: "#REF!" },
      ),
    ).toBe(false);
  });

  it("probes kinds", () => {
    expect(hits({ column: "a", op: "isNumber" }, 1)).toBe(true);
    expect(hits({ column: "a", op: "isText" }, "x")).toBe(true);
    expect(hits({ column: "a", op: "isText" }, "2026-01-15")).toBe(false);
  });
});

describe("in and between", () => {
  it("compares element-wise within kind", () => {
    expect(
      hits({ column: "a", op: "in", values: ["EMEA", "APAC"] }, "emea"),
    ).toBe(true);
    expect(hits({ column: "a", op: "in", values: [1, 2] }, "1")).toBe(false);
  });

  it("is inclusive", () => {
    const condition: Condition = {
      column: "a",
      op: "between",
      values: [10, 20],
    };
    expect(hits(condition, 10)).toBe(true);
    expect(hits(condition, 20)).toBe(true);
    expect(hits(condition, 21)).toBe(false);
  });
});

describe("validation", () => {
  it("rejects an inverted between", () => {
    expect(
      codeOf(() =>
        validateCondition({ column: "a", op: "between", values: [20, 10] }),
      ),
    ).toBe("invalid_argument");
  });

  it("rejects an empty in list", () => {
    expect(
      codeOf(() => validateCondition({ column: "a", op: "in", values: [] })),
    ).toBe("invalid_argument");
  });

  it("rejects a boolean operand for an ordering operator", () => {
    expect(
      codeOf(() => validateCondition({ column: "a", op: "gt", value: true })),
    ).toBe("invalid_argument");
  });

  it("rejects a missing operand", () => {
    expect(codeOf(() => validateCondition({ column: "a", op: "eq" }))).toBe(
      "invalid_argument",
    );
  });

  it("rejects non-text for a text operator", () => {
    expect(
      codeOf(() =>
        validateCondition({ column: "a", op: "contains", value: 5 }),
      ),
    ).toBe("invalid_argument");
  });
});

describe("coerceText", () => {
  const coercing: PredicateOptions = { caseSensitive: false, coerceText: true };

  it("accepts plain numeric text and refuses ambiguous forms", () => {
    expect(
      hits({ column: "a", op: "gt", value: 1000 }, "1234.50", coercing),
    ).toBe(true);
    expect(
      hits({ column: "a", op: "gt", value: 1000 }, "1.234,56", coercing),
    ).toBe(false);
    expect(hits({ column: "a", op: "gt", value: 1 }, "0x10", coercing)).toBe(
      false,
    );
    expect(hits({ column: "a", op: "gt", value: -1 }, "", coercing)).toBe(
      false,
    );
  });

  it("is off by default", () => {
    expect(hits({ column: "a", op: "gt", value: 1000 }, "1234.50")).toBe(false);
    expect(hits({ column: "a", op: "eq", value: "007" }, "007")).toBe(true);
  });
});

describe("census", () => {
  it("counts every kind and flags numeric text", () => {
    const census = emptyCensus();
    for (const value of [
      1,
      "2026-01-15",
      "x",
      "12",
      true,
      { error: "#N/A" },
      null,
    ] as CellScalar[]) {
      record(census, value);
    }
    expect(census).toMatchObject({
      numbers: 1,
      dates: 1,
      texts: 2,
      booleans: 1,
      errors: 1,
      nulls: 1,
      numericTexts: 1,
    });
  });

  it("picks the majority comparable kind", () => {
    const census = emptyCensus();
    record(census, 1);
    record(census, 2);
    record(census, "x");
    expect(majorityKind(census)).toBe("number");
  });
});
