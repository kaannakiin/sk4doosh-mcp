import { XmlDocument } from "libxml2-wasm";
import { describe, expect, it } from "vitest";
import { describeDocument } from "../src/describe.js";
import { clark } from "../src/node-model.js";
import { surveyNamespaces } from "../src/namespaces.js";
import { HARDENED } from "../src/parse-policy.js";
import { resolveAddress, walk } from "../src/traverse.js";

function parse(xml: string): XmlDocument {
  return XmlDocument.fromBuffer(Buffer.from(xml, "utf8"), { option: HARDENED });
}

function textUnder(
  document: XmlDocument,
  uri: string,
  localName: string,
): string {
  const scope = resolveAddress(document.root, [
    {
      namespaceUri: document.root.namespaceUri,
      localName: document.root.name,
      occurrence: 1,
    },
    { namespaceUri: uri, localName, occurrence: 1 },
  ]);
  if (scope === undefined) return "";
  const page = walk(scope, { maxNodes: 8, maxDepth: 2, maxChars: 512 });
  const text = page.records.find((record) => record.kind === "text");
  return text !== undefined && "value" in text ? text.value : "";
}

const traps =
  '<root xmlns="urn:default" xmlns:a="urn:alpha">' +
  "<id>default-one</id>" +
  "<a:id>alpha-one</a:id>" +
  '<child xmlns:a="urn:beta"><a:id>beta-one</a:id></child>' +
  '<plain kind="bare" a:kind="qualified"/>' +
  "</root>";

describe("expanded names", () => {
  it("treats the same URI and local name as one identity", () => {
    expect(clark({ namespaceUri: "urn:a", localName: "id" })).toBe("{urn:a}id");
    expect(clark({ namespaceUri: "", localName: "id" })).toBe("id");
  });

  it("keeps the same local name in two URIs apart", () => {
    const document = parse(traps);
    try {
      expect(textUnder(document, "urn:default", "id")).toBe("default-one");
      expect(textUnder(document, "urn:alpha", "id")).toBe("alpha-one");
      expect(textUnder(document, "urn:beta", "id")).toBe("");
    } finally {
      document.dispose();
    }
  });

  it("follows a rebound prefix to its new URI", () => {
    const document = parse(traps);
    try {
      const scope = resolveAddress(document.root, [
        { namespaceUri: "urn:default", localName: "root", occurrence: 1 },
        { namespaceUri: "urn:default", localName: "child", occurrence: 1 },
        { namespaceUri: "urn:beta", localName: "id", occurrence: 1 },
      ]);
      expect(scope).toBeDefined();
      const page = walk(
        scope ?? { element: document.root, path: [1], address: [] },
        {
          maxNodes: 4,
          maxDepth: 1,
          maxChars: 512,
        },
      );
      const text = page.records.find((record) => record.kind === "text");
      expect(text !== undefined && "value" in text ? text.value : "").toBe(
        "beta-one",
      );
    } finally {
      document.dispose();
    }
  });

  it("gives selection the same answer when only the prefix spelling changes", () => {
    const withA = parse('<r xmlns:a="urn:one"><a:leaf>value</a:leaf></r>');
    const withZ = parse('<r xmlns:zz="urn:one"><zz:leaf>value</zz:leaf></r>');
    try {
      const address = [
        { namespaceUri: "", localName: "r", occurrence: 1 },
        { namespaceUri: "urn:one", localName: "leaf", occurrence: 1 },
      ];
      const left = resolveAddress(withA.root, address);
      const right = resolveAddress(withZ.root, address);
      expect(left?.path).toStrictEqual(right?.path);
      expect(left?.address).toStrictEqual(right?.address);
    } finally {
      withA.dispose();
      withZ.dispose();
    }
  });

  it("leaves an unprefixed attribute out of the default namespace", () => {
    const document = parse(traps);
    try {
      const page = walk(
        resolveAddress(document.root, []) ?? {
          element: document.root,
          path: [1],
          address: [],
        },
        { maxNodes: 100, maxDepth: 4, maxChars: 512 },
      );
      const plain = page.records.find(
        (record) => record.kind === "element" && record.localName === "plain",
      );
      const attributes =
        plain !== undefined && plain.kind === "element" ? plain.attributes : [];
      expect(
        attributes.map((attribute) => [
          attribute.namespaceUri,
          attribute.localName,
        ]),
      ).toStrictEqual([
        ["", "kind"],
        ["urn:alpha", "kind"],
      ]);
    } finally {
      document.dispose();
    }
  });

  it("never presents a namespace declaration as an ordinary attribute", () => {
    const document = parse(traps);
    try {
      const page = walk(
        resolveAddress(document.root, []) ?? {
          element: document.root,
          path: [1],
          address: [],
        },
        { maxNodes: 100, maxDepth: 4, maxChars: 512 },
      );
      for (const record of page.records) {
        if (record.kind !== "element") continue;
        for (const attribute of record.attributes) {
          expect(attribute.localName).not.toBe("xmlns");
          expect(attribute.prefixedName.startsWith("xmlns:")).toBe(false);
        }
      }
      const root = page.records[0];
      expect(
        root !== undefined && root.kind === "element"
          ? root.namespaceDeclarations
          : undefined,
      ).toStrictEqual([
        { prefix: "", uri: "urn:default" },
        { prefix: "a", uri: "urn:alpha" },
      ]);
    } finally {
      document.dispose();
    }
  });
});

describe("query aliases", () => {
  it("gives a non-empty default namespace a synthetic prefix", () => {
    const document = parse('<r xmlns="urn:default"><c/></r>');
    try {
      const survey = surveyNamespaces(document.root, 100);
      expect(survey.aliases).toStrictEqual([
        {
          uri: "urn:default",
          alias: "ns1",
          declaredPrefixes: [],
          synthetic: true,
        },
      ]);
    } finally {
      document.dispose();
    }
  });

  it("keeps a declared prefix when nothing else claims it", () => {
    const document = parse('<a:r xmlns:a="urn:alpha"><a:c/></a:r>');
    try {
      const survey = surveyNamespaces(document.root, 100);
      expect(survey.aliases[0]).toStrictEqual({
        uri: "urn:alpha",
        alias: "a",
        declaredPrefixes: ["a"],
        synthetic: false,
      });
    } finally {
      document.dispose();
    }
  });

  it("hands a rebound prefix to one URI only", () => {
    const document = parse(traps);
    try {
      const survey = surveyNamespaces(document.root, 100);
      const aliases = survey.aliases.map((entry) => [entry.uri, entry.alias]);
      expect(aliases).toStrictEqual([
        ["urn:default", "ns1"],
        ["urn:alpha", "a"],
        ["urn:beta", "ns2"],
      ]);
      expect(new Set(survey.aliases.map((entry) => entry.alias)).size).toBe(3);
    } finally {
      document.dispose();
    }
  });

  it("marks a sampled survey as incomplete instead of claiming a total", () => {
    const document = parse(
      `<r>${Array.from({ length: 30 }, () => "<c/>").join("")}</r>`,
    );
    try {
      expect(surveyNamespaces(document.root, 5).complete).toBe(false);
      const facts = describeDocument(document, 5, 10);
      expect(facts.structure.elementCountExact).toBe(false);
      expect(facts.namespacesComplete).toBe(false);
    } finally {
      document.dispose();
    }
  });
});
