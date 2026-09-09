import { XmlDocument, XmlElement, type XmlNode } from "libxml2-wasm";
import { XmlProcessingInstructionNode } from "libxml2-wasm/lib/nodes.mjs";
import { describe, expect, it } from "vitest";
import type { CharacterRecord, NodeRecord } from "../src/node-model.js";
import { HARDENED } from "../src/parse-policy.js";
import {
  firstChildOf,
  kindOf,
  nextSibling,
  piTargetOf,
  resolveAddress,
  walk,
} from "../src/traverse.js";

const everyKind =
  '<root>lead<b>bold</b>mid<?render mode="fast"?><![CDATA[ raw ]]><!--remark--> tail </root>';

function parse(xml: string): XmlDocument {
  return XmlDocument.fromBuffer(Buffer.from(xml, "utf8"), { option: HARDENED });
}

function scopeOf(document: XmlDocument) {
  const scope = resolveAddress(document.root, []);
  if (scope === undefined) throw new Error("root did not resolve");
  return scope;
}

function read(document: XmlDocument, maxNodes = 500, maxDepth = 64) {
  return walk(scopeOf(document), { maxNodes, maxDepth, maxChars: 512 });
}

function describeRecord(record: NodeRecord): string {
  return record.kind === "element"
    ? `element:${record.localName}`
    : record.kind === "entityReference"
      ? `entityReference:${record.name}`
      : `${record.kind}:${JSON.stringify(record.value)}`;
}

describe("the sibling walk", () => {
  it("visits every child kind, matching the engine's own node() axis", () => {
    const document = parse(everyKind);
    try {
      const oracle = document.root
        .find("node()")
        .map((node: XmlNode) => node.constructor.name);
      const walked: string[] = [];
      for (
        let child = firstChildOf(document.root);
        child !== undefined;
        child = nextSibling(child)
      ) {
        walked.push(child.constructor.name);
      }
      expect(walked).toStrictEqual(oracle);
      expect(walked).toHaveLength(7);
    } finally {
      document.dispose();
    }
  });

  it("reaches the processing-instruction class the package root omits", () => {
    const document = parse(everyKind);
    try {
      const nodes: XmlNode[] = [];
      for (
        let child = firstChildOf(document.root);
        child !== undefined;
        child = nextSibling(child)
      ) {
        nodes.push(child);
      }
      const instruction = nodes.find((node) => kindOf(node) === "pi");
      expect(instruction).toBeInstanceOf(XmlProcessingInstructionNode);
      expect(instruction === undefined ? "" : piTargetOf(instruction)).toBe(
        "render",
      );
    } finally {
      document.dispose();
    }
  });

  it("separates cdata from text rather than folding them together", () => {
    const document = parse(everyKind);
    try {
      const kinds = read(document).records.map((record) => record.kind);
      expect(kinds).toContain("cdata");
      expect(kinds).toContain("text");
      expect(kinds).toContain("comment");
      expect(kinds).toContain("pi");
    } finally {
      document.dispose();
    }
  });
});

describe("ordered content", () => {
  it("keeps text, element, comment and instruction order across kinds", () => {
    const document = parse(everyKind);
    try {
      const shown = read(document).records.map(describeRecord);
      expect(shown).toStrictEqual([
        "element:root",
        'text:"lead"',
        "element:b",
        'text:"bold"',
        'text:"mid"',
        'pi:"mode=\\"fast\\""',
        'cdata:" raw "',
        'comment:"remark"',
        'text:" tail "',
      ]);
    } finally {
      document.dispose();
    }
  });

  it("returns whitespace-only text without trimming it", () => {
    const document = parse("<r>  \n  <c/>\t</r>");
    try {
      const values = read(document)
        .records.filter(
          (record): record is CharacterRecord => record.kind === "text",
        )
        .map((record) => record.value);
      expect(values).toStrictEqual(["  \n  ", "\t"]);
    } finally {
      document.dispose();
    }
  });

  it("numbers every child kind in one childIndex sequence", () => {
    const document = parse(everyKind);
    try {
      const children = read(document).records.filter(
        (record) => record.parentId === "1",
      );
      expect(children.map((record) => record.childIndex)).toStrictEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
      expect(children.map((record) => record.kind)).toStrictEqual([
        "text",
        "element",
        "text",
        "pi",
        "cdata",
        "comment",
        "text",
      ]);
    } finally {
      document.dispose();
    }
  });
});

describe("the depth limit", () => {
  it("marks a held-back element instead of dropping it silently", () => {
    const document = parse("<a><b><c><d/></c></b></a>");
    try {
      const page = walk(scopeOf(document), {
        maxNodes: 100,
        maxDepth: 1,
        maxChars: 512,
      });
      const shown = page.records.map((record) =>
        record.kind === "element"
          ? `${record.localName}:${String(record.childrenOmitted ?? false)}`
          : record.kind,
      );
      expect(shown).toStrictEqual(["a:false", "b:true"]);
      expect(page.next).toBeUndefined();
    } finally {
      document.dispose();
    }
  });

  it("does not promise the skipped children through a cursor", () => {
    const document = parse("<a><b><c/></b><e/></a>");
    try {
      const page = walk(scopeOf(document), {
        maxNodes: 100,
        maxDepth: 1,
        maxChars: 512,
      });
      expect(page.records.map((record) => record.nodeId)).toStrictEqual([
        "1",
        "1.1",
        "1.2",
      ]);
      expect(page.next).toBeUndefined();
    } finally {
      document.dispose();
    }
  });
});

describe("addressing", () => {
  it("picks the occurrence the address names", () => {
    const document = parse("<r><i>one</i><i>two</i><i>three</i></r>");
    try {
      const scope = resolveAddress(document.root, [
        { namespaceUri: "", localName: "r", occurrence: 1 },
        { namespaceUri: "", localName: "i", occurrence: 2 },
      ]);
      expect(scope).toBeDefined();
      const page = walk(scope ?? scopeOf(document), {
        maxNodes: 10,
        maxDepth: 8,
        maxChars: 512,
      });
      expect(page.records.map(describeRecord)).toStrictEqual([
        "element:i",
        'text:"two"',
      ]);
    } finally {
      document.dispose();
    }
  });

  it("refuses an address whose namespace does not match", () => {
    const document = parse('<r xmlns="urn:a"><i/></r>');
    try {
      expect(
        resolveAddress(document.root, [
          { namespaceUri: "urn:b", localName: "r", occurrence: 1 },
        ]),
      ).toBeUndefined();
    } finally {
      document.dispose();
    }
  });

  it("counts occurrence per expanded name, not per position", () => {
    const document = parse(
      '<r xmlns:a="urn:a"><x/><a:x/><x/></r>',
    );
    try {
      const scope = resolveAddress(document.root, [
        { namespaceUri: "", localName: "r", occurrence: 1 },
        { namespaceUri: "", localName: "x", occurrence: 2 },
      ]);
      expect(scope?.path).toStrictEqual([1, 3]);
    } finally {
      document.dispose();
    }
  });
});

describe("element content", () => {
  it("never reports an element's concatenated descendant text as a value", () => {
    const document = parse("<r><a>one</a><b>two</b></r>");
    try {
      const root = read(document).records[0];
      expect(root?.kind).toBe("element");
      expect(root).not.toHaveProperty("value");
      expect(document.root).toBeInstanceOf(XmlElement);
      expect(document.root.content).toBe("onetwo");
    } finally {
      document.dispose();
    }
  });
});
