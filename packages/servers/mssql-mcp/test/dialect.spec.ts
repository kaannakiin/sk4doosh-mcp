import { describe, expect, it } from "vitest";
import { DbSourceError, type ErrorFactory } from "@sk-mcp/db-core";
import type { DbErrorCode } from "@sk-mcp/db-core";
import { classify } from "../src/dialect/types.js";
import { mapDriverError } from "../src/dialect/errors.js";
import { readOnlyGuard } from "../src/dialect/guard.js";
import { quoteIdentifier, quoteQualified } from "../src/dialect/quote.js";
import { mssqlDialect } from "../src/dialect/index.js";

const fail: ErrorFactory<DbErrorCode> = (code, message, recovery) =>
  new DbSourceError(code, message, recovery);

describe("quoteIdentifier", () => {
  it("doubles the closing bracket, which is the only escape", () => {
    expect(quoteIdentifier("a]b", fail)).toBe("[a]]b]");
    expect(quoteIdentifier("Orders", fail)).toBe("[Orders]");
  });

  it("refuses an identifier that could not survive quoting", () => {
    expect(() => quoteIdentifier("", fail)).toThrow();
    expect(() => quoteIdentifier("a".repeat(129), fail)).toThrow();
    expect(() => quoteIdentifier("a\u0000b", fail)).toThrow();
  });

  it("qualifies both halves", () => {
    expect(quoteQualified({ schema: "dbo", name: "Or]ders" }, fail)).toBe(
      "[dbo].[Or]]ders]",
    );
  });
});

describe("classify", () => {
  it("answers both vocabularies for the same column", () => {
    expect(classify({ typeName: "NVarChar" })).toBe("text");
    expect(classify({ typeName: "nvarchar" })).toBe("text");
  });

  it("maps the exact-numeric family to decimal and the wide integer to bigint", () => {
    for (const name of ["decimal", "numeric", "money", "smallmoney"]) {
      expect(classify({ typeName: name })).toBe("decimal");
    }
    expect(classify({ typeName: "bigint" })).toBe("bigint");
    expect(classify({ typeName: "int" })).toBe("integer");
  });

  it("separates the two timestamp families", () => {
    expect(classify({ typeName: "datetime2" })).toBe("timestamp");
    expect(classify({ typeName: "datetimeoffset" })).toBe("timestamptz");
  });

  it("falls back to unknown rather than guessing", () => {
    expect(classify({ typeName: "geography" })).toBe("unknown");
    expect(classify({ typeName: "" })).toBe("unknown");
  });
});

describe("readOnlyGuard", () => {
  const allows = (sql: string) => readOnlyGuard(sql).verdict === "allow";

  it("allows a plain select and a common table expression", () => {
    expect(allows("select 1")).toBe(true);
    expect(allows("  SELECT * FROM dbo.Orders  ")).toBe(true);
    expect(allows("with x as (select 1 as n) select n from x")).toBe(true);
  });

  it("allows a trailing semicolon but refuses a batch", () => {
    expect(allows("select 1;")).toBe(true);
    expect(allows("select 1; drop table dbo.Orders")).toBe(false);
  });

  it("refuses anything that does not begin with SELECT or WITH", () => {
    for (const sql of [
      "delete from dbo.Orders",
      "update dbo.Orders set a = 1",
      "exec sp_who",
      "drop table dbo.Orders",
    ]) {
      expect(allows(sql)).toBe(false);
    }
  });

  it("refuses SELECT INTO, which creates a table", () => {
    expect(allows("select * into #t from dbo.Orders")).toBe(false);
  });

  it("refuses WAITFOR, which holds the connection open", () => {
    expect(allows("select 1 where 1 = 0 waitfor delay '00:10:00'")).toBe(false);
  });

  it("does not trip on a keyword inside a string literal", () => {
    expect(allows("select 'drop me' as note")).toBe(true);
    expect(allows("select 'it''s a delete' as note")).toBe(true);
  });

  it("does not trip on a keyword inside a bracketed identifier", () => {
    expect(allows("select [delete] from dbo.Orders")).toBe(true);
  });

  it("strips comments before looking, in both forms", () => {
    expect(allows("-- drop table t\nselect 1")).toBe(true);
    expect(allows("select 1 /* drop table t */")).toBe(true);
  });

  it("refuses a statement that is only a comment", () => {
    expect(allows("-- nothing here")).toBe(false);
    expect(allows("   ")).toBe(false);
  });

  it("refuses a system procedure by prefix", () => {
    expect(allows("select * from sp_helpsomething()")).toBe(false);
  });

  it("names the keyword it refused, so the agent can fix it", () => {
    const outcome = readOnlyGuard("select * into #t from dbo.Orders");
    expect(outcome.verdict).toBe("refuse");
    if (outcome.verdict === "refuse") {
      expect(outcome.reason).toContain("INTO");
      expect(outcome.recovery.length).toBeGreaterThan(0);
    }
  });
});

describe("mapDriverError", () => {
  it("reads the number for a server-side fault", () => {
    expect(
      mapDriverError({
        code: "EREQUEST",
        number: 208,
        message: "Invalid object name 'x'.",
      }),
    ).toMatchObject({ code: "object_not_found", engineCode: 208 });
  });

  it("treats an unrecognised first word as a user error, not a server fault", () => {
    expect(
      mapDriverError({ code: "EREQUEST", number: 2812, message: "..." }),
    ).toMatchObject({ code: "invalid_argument" });
  });

  it("reads the code for a connection-level fault", () => {
    expect(
      mapDriverError({ code: "ECANCEL", message: "Canceled." }),
    ).toMatchObject({ code: "query_cancelled" });
    expect(mapDriverError({ code: "ESOCKET", message: "..." })).toMatchObject({
      code: "connection_failed",
    });
    expect(mapDriverError({ code: "ELOGIN", message: "..." })).toMatchObject({
      code: "authentication_failed",
    });
  });

  it("falls back to query_failed for an unmapped server number", () => {
    expect(
      mapDriverError({ code: "EREQUEST", number: 99999, message: "..." }),
    ).toMatchObject({ code: "query_failed" });
  });

  it("returns undefined for something that is not a driver error", () => {
    expect(
      mapDriverError(new TypeError("x is not a function")),
    ).toBeUndefined();
    expect(mapDriverError("boom")).toBeUndefined();
    expect(mapDriverError(null)).toBeUndefined();
  });
});

describe("the dialect as a whole", () => {
  it("reports no session-level read-only guarantee, because there is none", () => {
    expect(mssqlDialect.sessionIntent()).toBe("none");
  });

  it("opens every connection with a lock timeout", () => {
    const setup = mssqlDialect.sessionSetup();
    expect(setup).toHaveLength(1);
    expect(setup[0]?.sql).toContain("lock_timeout");
  });

  it("carries connection-string patterns beyond the core's", () => {
    expect(mssqlDialect.secretPatterns.length).toBeGreaterThan(4);
  });
});
