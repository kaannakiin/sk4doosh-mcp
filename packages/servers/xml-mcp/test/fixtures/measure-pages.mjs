import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDocumentRoot,
  createHandlers,
  createXmlDocumentCache,
  createXmlWorkerPool,
} from "../../dist/index.js";

const root = await mkdtemp(join(tmpdir(), "xml-mcp-measure-"));

const shapes = {
  flat: (n) =>
    `<w>${Array.from({ length: n }, (_, i) => `<i>v${i}</i>`).join("")}</w>`,
  attributes: (n) =>
    `<w>${Array.from(
      { length: n },
      (_, i) =>
        `<i ${Array.from({ length: 8 }, (__, k) => `a${k}="${"x".repeat(40)}"`).join(" ")}>v${i}</i>`,
    ).join("")}</w>`,
  text: (n) =>
    `<w>${Array.from({ length: n }, (_, i) => `<i>${"t".repeat(400)}${i}</i>`).join("")}</w>`,
  deep: (n) => `<w>${"<n>".repeat(n)}leaf${"</n>".repeat(n)}</w>`,
};

for (const [name, build] of Object.entries(shapes)) {
  await writeFile(
    join(root, `${name}.xml`),
    `${build(name === "deep" ? 100 : 400)}\n`,
    "utf8",
  );
}

const documentRoot = await createDocumentRoot(root);
const pool = createXmlWorkerPool();
const cache = createXmlDocumentCache(pool, documentRoot.real);
const handlers = createHandlers(documentRoot, { pool, cache });

const bytesOf = (result) =>
  result.content.reduce(
    (total, block) =>
      total +
      (block.type === "text" ? Buffer.byteLength(block.text, "utf8") : 0),
    0,
  );

const rows = [];
for (const shape of Object.keys(shapes)) {
  for (const maxNodes of [50, 200]) {
    const result = await handlers.read_node({
      filePath: `${shape}.xml`,
      maxNodes,
    });
    const body = JSON.parse(result.content[0].text);
    rows.push({
      tool: "read_node",
      shape,
      maxNodes,
      returned: body.returnedCount ?? 0,
      bytes: bytesOf(result),
      perRecord: Math.round(
        bytesOf(result) / Math.max(1, body.returnedCount ?? 1),
      ),
      reason: body.truncationReason ?? "none",
    });
  }
  const found = await handlers.find_in_document({
    filePath: `${shape}.xml`,
    query: "v",
    maxResults: 200,
  });
  const foundBody = JSON.parse(found.content[0].text);
  rows.push({
    tool: "find_in_document",
    shape,
    maxNodes: 200,
    returned: foundBody.returnedCount ?? 0,
    bytes: bytesOf(found),
    perRecord: Math.round(
      bytesOf(found) / Math.max(1, foundBody.returnedCount ?? 1),
    ),
    reason: foundBody.truncationReason ?? "none",
  });
  const described = await handlers.describe_document({
    filePath: `${shape}.xml`,
  });
  rows.push({
    tool: "describe_document",
    shape,
    maxNodes: 0,
    returned: 1,
    bytes: bytesOf(described),
    perRecord: bytesOf(described),
    reason: "none",
  });
}

const listed = await handlers.list_documents({});
rows.push({
  tool: "list_documents",
  shape: "-",
  maxNodes: 0,
  returned: JSON.parse(listed.content[0].text).files.length,
  bytes: bytesOf(listed),
  perRecord: 0,
  reason: "none",
});

console.log(JSON.stringify({ limit: 512 * 1024, rows }, null, 1));

await pool.close();
await rm(root, { recursive: true, force: true });
process.exit(0);
