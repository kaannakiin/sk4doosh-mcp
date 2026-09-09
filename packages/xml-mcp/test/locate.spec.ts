import { XmlDocument, XmlElement, type XmlNode } from "libxml2-wasm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locate, nodeIdOf, previousSibling } from "../src/locate.js";
import { formatAddress, formatNodeId } from "../src/node-model.js";
import { HARDENED } from "../src/parse-policy.js";
import { firstChildOf, nextSibling, walk } from "../src/traverse.js";

const source =
  '<?xml version="1.0"?>\n' +
  "<!-- prolog remark -->\n" +
  "<?prolog-pi early?>\n" +
  '<root id="r">' +
  "<a>one</a>" +
  "<?body-pi go?>" +
  "<a>two</a>" +
  "<!--inner-->" +
  "<b><a>three</a></b>" +
  "</root>\n";

let document: XmlDocument;

beforeAll(() => {
  document = XmlDocument.fromBuffer(Buffer.from(source, "utf8"), {
    option: HARDENED,
  });
});

afterAll(() => {
  document.dispose();
});

function childrenOf(element: XmlElement): readonly XmlNode[] {
  const found: XmlNode[] = [];
  for (
    let child: XmlNode | undefined = firstChildOf(element);
    child !== undefined;
    child = nextSibling(child)
  ) {
    found.push(child);
  }
  return found;
}

describe("the borrowed previous-sibling getter", () => {
  it("walks back over a processing instruction the same way the forward walk does", () => {
    const children = childrenOf(document.root);
    expect(children).toHaveLength(5);
    for (let index = children.length - 1; index > 0; index -= 1) {
      const current = children[index];
      const expected = children[index - 1];
      expect(current, String(index)).toBeDefined();
      const previous = previousSibling(current as XmlNode);
      expect(previous, String(index)).toBeDefined();
      expect(
        (previous as XmlNode).isSameNode(expected as XmlNode),
        String(index),
      ).toBe(true);
    }
    expect(previousSibling(children[0] as XmlNode)).toBeUndefined();
  });
});

describe("locating a node from the node itself", () => {
  it("agrees with the forward walk on every addressable node", () => {
    const page = walk(
      {
        element: document.root,
        path: [1],
        address: [
          { namespaceUri: "", localName: document.root.name, occurrence: 1 },
        ],
      },
      { maxNodes: 200, maxDepth: 10, maxChars: 512 },
    );
    const walked = new Map(
      page.records.map((record) => [
        record.nodeId,
        "address" in record ? formatAddress(record.address) : undefined,
      ]),
    );

    for (const node of document.eval("//node()") as XmlNode[]) {
      const placement = locate(node, document.root);
      if (!placement.located) continue;
      const id = nodeIdOf(placement);
      expect(walked.has(id), id).toBe(true);
      if (node instanceof XmlElement) {
        expect(formatAddress(placement.address), id).toBe(walked.get(id));
      }
    }
  });

  it("counts occurrence among same-name siblings, not among all siblings", () => {
    const second = (document.eval("/root/a[2]") as XmlNode[])[0];
    expect(second).toBeDefined();
    const placement = locate(second as XmlNode, document.root);
    expect(placement.located).toBe(true);
    if (placement.located) {
      expect(formatAddress(placement.address)).toBe("root/a[2]");
      expect(formatNodeId(placement.path)).toBe("1.3");
    }
  });

  it("addresses the document element itself", () => {
    const placement = locate(document.root, document.root);
    expect(placement.located).toBe(true);
    if (placement.located) {
      expect(placement.path).toStrictEqual([1]);
      expect(formatAddress(placement.address)).toBe("root");
    }
  });

  it("refuses to address a node that hangs above the document element", () => {
    for (const node of document.eval(
      "/comment() | /processing-instruction()",
    ) as XmlNode[]) {
      const placement = locate(node, document.root);
      expect(placement.located).toBe(false);
      if (!placement.located) expect(placement.reason).toBe("prolog");
    }
  });

  it("throws rather than giving an attribute a sibling index", () => {
    const attribute = (document.eval("//@id") as XmlNode[])[0];
    expect(attribute).toBeDefined();
    expect(() => locate(attribute as XmlNode, document.root)).toThrow(
      "locate_received_attribute",
    );
  });
});
