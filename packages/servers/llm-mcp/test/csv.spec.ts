import { describe, expect, it } from "vitest";
import {
  csvField,
  delimiterOf,
  fieldsOf,
  parseTable,
  splitRecords,
} from "../src/platform/csv.js";

describe("splitRecords", () => {
  it("keeps a quoted line break and comma inside one record", () => {
    expect(splitRecords('id,text\n1,"a, b\nc"\n2,d\n')).toEqual([
      "id,text",
      '1,"a, b\nc"',
      "2,d",
    ]);
  });

  it("strips CRLF and drops blank records", () => {
    expect(splitRecords("id,x\r\n1,a\r\n\r\n2,b\r\n")).toEqual([
      "id,x",
      "1,a",
      "2,b",
    ]);
  });

  it("treats a doubled quote as part of the field", () => {
    expect(splitRecords('id,x\n1,"say ""hi""\n there"\n')).toEqual([
      "id,x",
      '1,"say ""hi""\n there"',
    ]);
  });
});

describe("delimiterOf", () => {
  it.each([
    ["id,tarih,tutar", ","],
    ["id;tarih;tutar", ";"],
    ["id\ttarih\ttutar", "\t"],
    ['"a;b",c,d', ","],
  ] as const)("reads %j as %j", (header, expected) => {
    expect(delimiterOf(header)).toBe(expected);
  });
});

describe("fieldsOf and csvField", () => {
  it("unquotes fields", () => {
    expect(fieldsOf('1,"a, ""b""",c', ",")).toEqual(["1", 'a, "b"', "c"]);
  });

  it("quotes only when needed", () => {
    expect(csvField("SELL", ",")).toBe("SELL");
    expect(csvField("a,b", ",")).toBe('"a,b"');
    expect(csvField("a;b", ",")).toBe("a;b");
    expect(csvField('say "x"', ";")).toBe('"say ""x"""');
  });
});

describe("parseTable", () => {
  it("splits the header from the rows and detects the delimiter", () => {
    expect(parseTable("a;b\n1;2\n3;4\n")).toEqual({
      header: "a;b",
      rows: ["1;2", "3;4"],
      delimiter: ";",
    });
  });

  it("returns undefined for empty text", () => {
    expect(parseTable("\n\n")).toBeUndefined();
  });
});
