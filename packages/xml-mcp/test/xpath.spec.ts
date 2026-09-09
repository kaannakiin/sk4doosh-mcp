import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
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

interface Member {
  readonly kind: string;
  readonly localName?: string;
  readonly value?: string;
  readonly target?: string;
  readonly nodeId?: string;
  readonly unaddressable?: string;
  readonly address?: readonly { readonly localName: string }[];
}

function members(body: Record<string, unknown>): readonly Member[] {
  return body["members"] as readonly Member[];
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("typed results", () => {
  it("keeps a node-set separate from the three scalar types", async () => {
    const nodes = await select({
      filePath: basename(fixtures.pom),
      xpath: "//m:artifactId",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    expect(nodes.body["resultType"]).toBe("nodeset");

    const text = await select({
      filePath: basename(fixtures.pom),
      xpath: "string(//m:artifactId)",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    expect(text.body["resultType"]).toBe("string");
    expect(text.body["value"]).toBe("alpha");

    const flag = await select({
      filePath: basename(fixtures.pom),
      xpath: "boolean(//m:artifactId)",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    expect(flag.body["resultType"]).toBe("boolean");
    expect(flag.body["value"]).toBe(true);

    const number = await select({
      filePath: basename(fixtures.pom),
      xpath: "count(//m:dependency)",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    expect(number.body["resultType"]).toBe("number");
    expect(number.body["value"]).toBe(2);
  });

  it("reports an empty node-set as a success, not as nothing", async () => {
    const outcome = await select({
      filePath: basename(fixtures.simple),
      xpath: "//missing",
    });
    expect(outcome.isError).toBe(false);
    expect(outcome.body["resultType"]).toBe("nodeset");
    expect(outcome.body["members"]).toStrictEqual([]);
    expect(outcome.body["totalMembers"]).toBe(0);
    expect(outcome.body["complete"]).toBe(true);
  });

  it("keeps false, zero and the empty string as themselves", async () => {
    const flag = await select({
      filePath: basename(fixtures.simple),
      xpath: "boolean(//missing)",
    });
    expect(flag.body["value"]).toBe(false);

    const zero = await select({
      filePath: basename(fixtures.simple),
      xpath: "count(//missing)",
    });
    expect(zero.body["value"]).toBe(0);
    expect(zero.body["numberKind"]).toBe("finite");

    const empty = await select({
      filePath: basename(fixtures.simple),
      xpath: "string(//missing)",
    });
    expect(empty.body["value"]).toBe("");
    expect(empty.body["truncated"]).toBe(false);
  });

  it("names every number that JSON cannot carry", async () => {
    const cases = [
      ["0 div 0", "nan", "NaN"],
      ["1 div 0", "positiveInfinity", "Infinity"],
      ["-1 div 0", "negativeInfinity", "-Infinity"],
    ] as const;
    for (const [expression, kind, text] of cases) {
      const outcome = await select({
        filePath: basename(fixtures.simple),
        xpath: expression,
      });
      expect(outcome.body["numberKind"]).toBe(kind);
      expect(outcome.body["value"]).toBeNull();
      expect(outcome.body["valueText"]).toBe(text);
    }
  });

  it("distinguishes negative zero from zero", async () => {
    const outcome = await select({
      filePath: basename(fixtures.simple),
      xpath: "-0",
    });
    expect(outcome.body["numberKind"]).toBe("negativeZero");
    expect(outcome.body["valueText"]).toBe("-0");
  });
});

describe("node-set members", () => {
  it("addresses an element with a canonical address and a node id", async () => {
    const outcome = await select({
      filePath: basename(fixtures.pom),
      xpath: "//m:dependency[2]/m:version",
      namespaces: [{ prefix: "m", uri: maven }],
    });
    const [member] = members(outcome.body);
    expect(member?.kind).toBe("element");
    expect(member?.localName).toBe("version");
    expect(member?.nodeId).toBeDefined();
    expect(member?.address?.map((step) => step.localName)).toStrictEqual([
      "project",
      "dependencies",
      "dependency",
      "version",
    ]);
  });

  it("gives an attribute the owner address and its own value", async () => {
    const outcome = await select({
      filePath: basename(fixtures.junit),
      xpath: "//failure/@message",
    });
    expect(outcome.body["totalMembers"]).toBe(2);
    const [first] = members(outcome.body);
    expect(first?.kind).toBe("attribute");
    expect(first?.value).toBe("expected 2 but was 3");
    expect(first?.address?.map((step) => step.localName)).toStrictEqual([
      "testsuites",
      "testsuite",
      "testcase",
      "failure",
    ]);
  });

  it("separates text, cdata, comment and processing instructions", async () => {
    const outcome = await select({
      filePath: basename(fixtures.mixed),
      xpath: "//node()",
    });
    const kinds = new Set(members(outcome.body).map((member) => member.kind));
    expect(kinds).toContain("text");
    expect(kinds).toContain("cdata");
    expect(kinds).toContain("comment");
    expect(kinds).toContain("pi");
    const instruction = members(outcome.body).find(
      (member) => member.kind === "pi",
    );
    expect(instruction?.target).toBe("render");
  });

  it("reports the root node of the document as unaddressable", async () => {
    const outcome = await select({
      filePath: basename(fixtures.simple),
      xpath: "/",
    });
    const [member] = members(outcome.body);
    expect(member?.kind).toBe("document");
    expect(member?.unaddressable).toBe("document");
    expect(member?.nodeId).toBeUndefined();
  });

  it("marks a prolog comment and processing instruction unaddressable rather than guessing a path", async () => {
    const outcome = await select({
      filePath: basename(fixtures.prologNodes),
      xpath: "/comment() | /processing-instruction()",
    });
    const prolog = members(outcome.body);
    expect(prolog.length).toBeGreaterThan(0);
    for (const member of prolog) {
      expect(member.unaddressable).toBe("prolog");
      expect(member.nodeId).toBeUndefined();
    }
  });

  it("addresses a comment and processing instruction that sit inside the document element", async () => {
    const outcome = await select({
      filePath: basename(fixtures.prologNodes),
      xpath: "/*/comment() | /*/processing-instruction()",
    });
    for (const member of members(outcome.body)) {
      expect(member.unaddressable).toBeUndefined();
      expect(member.nodeId).toBeDefined();
    }
  });
});

describe("engine order", () => {
  it("returns members in document order whatever order the expression names them", async () => {
    const forward = await select({
      filePath: basename(fixtures.wide),
      xpath: "//i[@k='1'] | //i[@k='0']",
    });
    const backward = await select({
      filePath: basename(fixtures.wide),
      xpath: "//i[@k='0'] | //i[@k='1']",
    });
    const ids = (
      body: Record<string, unknown>,
    ): readonly (string | undefined)[] =>
      members(body).map((member) => member.nodeId);
    expect(ids(forward.body)).toStrictEqual(ids(backward.body));
    expect(ids(forward.body)).toStrictEqual(["1.1", "1.2"]);
  });

  it("does not repeat a node that a union names twice", async () => {
    const outcome = await select({
      filePath: basename(fixtures.wide),
      xpath: "//i[@k='0'] | //i[@k='0']",
    });
    expect(outcome.body["totalMembers"]).toBe(1);
  });

  it("returns an ancestor axis in document order, not in reverse", async () => {
    const outcome = await select({
      filePath: basename(fixtures.deep),
      xpath: "//n[last()]/ancestor::*",
    });
    const depths = members(outcome.body).map(
      (member) => member.nodeId?.split(".").length ?? 0,
    );
    expect(depths).toStrictEqual([...depths].sort((a, b) => a - b));
  });
});

describe("compiled expression lifetime", () => {
  it("leaves nothing live after successful and failing evaluations", async () => {
    const counted = await createHarness(fixtures.root, { diagnostics: true });
    try {
      await counted.handlers.select_xpath({
        filePath: basename(fixtures.wide),
        xpath: "//i",
      } as Parameters<Harness["handlers"]["select_xpath"]>[0]);

      const baseline = await counted.pool.ask({ kind: "diag" });
      expect(baseline.ok).toBe(true);
      const before = baseline.ok ? baseline.value.live : -1;

      for (let round = 0; round < 20; round += 1) {
        await counted.handlers.select_xpath({
          filePath: basename(fixtures.wide),
          xpath: "//i",
        } as Parameters<Harness["handlers"]["select_xpath"]>[0]);
        await counted.handlers.select_xpath({
          filePath: basename(fixtures.wide),
          xpath: "//zz:missing",
        } as Parameters<Harness["handlers"]["select_xpath"]>[0]);
      }

      const after = await counted.pool.ask({ kind: "diag" });
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(after.value.live).toBe(before);
        expect(after.value.collected).toBe(0);
      }
    } finally {
      await counted.close();
    }
  });
});
