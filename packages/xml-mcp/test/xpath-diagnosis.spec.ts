import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  emptyResultDiagnostic,
  refuseUnsupported,
} from "../src/xpath-diagnosis.js";
import { lex } from "../src/xpath-lex.js";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

const maven = "http://maven.apache.org/POM/4.0.0";

let fixtures: Fixtures;
let harness: Harness;

async function select(args: Record<string, unknown>) {
  const result = await harness.handlers.select_xpath(
    args as Parameters<Harness["handlers"]["select_xpath"]>[0],
  );
  return { isError: result.isError === true, body: bodyOf(result) };
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("the expression lexer", () => {
  it("separates prefixes, unprefixed name tests, functions and axes", () => {
    const lexed = lex("//m:dependency/artifactId[contains(., 'a')]/@id");
    expect(lexed.prefixes).toStrictEqual(["m"]);
    expect(lexed.unprefixedNameTests).toContain("artifactId");
    expect(lexed.unprefixedNameTests).toContain("id");
    expect(lexed.functions).toStrictEqual(["contains"]);
    expect(lexed.axes).toStrictEqual([]);
  });

  it("reads an axis name as an axis, not as a name test", () => {
    const lexed = lex("//b/ancestor::node()");
    expect(lexed.axes).toStrictEqual(["ancestor"]);
    expect(lexed.unprefixedNameTests).not.toContain("ancestor");
  });

  it("ignores names that only appear inside string literals", () => {
    const lexed = lex("//a[@k='matches(zz:x)']");
    expect(lexed.functions).toStrictEqual([]);
    expect(lexed.prefixes).toStrictEqual([]);
  });

  it("does not read an operator word as a name test", () => {
    const lexed = lex("//a[@x='1' and @y='2']");
    expect(lexed.unprefixedNameTests).not.toContain("and");
  });
});

describe("refusing what the engine cannot do", () => {
  it("names the later-version function before evaluating anything", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//m:artifactId[matches(., 'a')]",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("query_not_supported");
    expect(String(outcome.body["message"])).toContain("matches()");
  });

  it("refuses a later-version function even when the step would match nothing", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//nothing[matches(., 'a')]",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("query_not_supported");
  });

  it("refuses the namespace axis, whose nodes it cannot report", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//namespace::*",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("query_not_supported");
  });

  it("leaves every XPath 1.0 function alone", () => {
    for (const expression of [
      "count(//a)",
      "sum(//a)",
      "string-length(//a)",
      "normalize-space(//a)",
      "substring-before(//a, 'x')",
      "translate(//a, 'x', 'y')",
      "starts-with(//a, 'x')",
      "not(//a)",
      "local-name(//a)",
    ]) {
      expect(refuseUnsupported(expression)).toBeUndefined();
    }
  });
});

describe("diagnosing a failure", () => {
  it("names an unbound prefix", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//zz:artifactId",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
    expect(String(outcome.body["message"])).toContain("zz");
    expect(String(outcome.body["recovery"])).toContain("describe_document");
  });

  it("says a syntax fault carries no position rather than inventing one", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//[",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
    expect(String(outcome.body["message"])).toContain("XPath 1.0");
  });

  it("reports a misspelled XPath 1.0 function as an argument fault, not a version fault", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "countt(//m:dependency)",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
    expect(String(outcome.body["message"])).toContain("countt");
  });

  it("refuses a prefix bound twice instead of taking the last one", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//m:artifactId",
      namespaces: [
        { prefix: "m", uri: maven },
        { prefix: "m", uri: "urn:other" },
      ],
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.body["error"]).toBe("invalid_argument");
  });
});

describe("the default namespace trap", () => {
  it("explains an empty node-set without running a second query", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//artifactId",
    });
    expect(outcome.isError).toBe(false);
    expect(outcome.body["totalMembers"]).toBe(0);
    const diagnostics = outcome.body["diagnostics"] as readonly {
      readonly code: string;
      readonly message: string;
    }[];
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("default_namespace_unprefixed");
    expect(diagnostics[0]?.message).toContain(maven);
    expect(outcome.body["members"]).toStrictEqual([]);
  });

  it("stays quiet when the expression is prefixed and simply matches nothing", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//m:nothingHere",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    expect(outcome.body["totalMembers"]).toBe(0);
    expect(outcome.body["diagnostics"]).toBeUndefined();
  });

  it("stays quiet on a document with no default namespace", async () => {
    expect(emptyResultDiagnostic("//name", "")).toBeUndefined();
  });

  it("says nothing when the result is not empty", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//m:artifactId",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    expect(outcome.body["diagnostics"]).toBeUndefined();
  });
});
