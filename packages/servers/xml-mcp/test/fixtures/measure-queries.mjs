import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDocumentRoot,
  createHandlers,
  createXmlDocumentCache,
  createXmlWorkerPool,
} from "../../dist/index.js";

const root = await mkdtemp(join(tmpdir(), "xml-mcp-query-measure-"));

const wide = (count) =>
  `<catalogue>${Array.from(
    { length: count },
    (_, index) =>
      `<entry code="c${index}"><name>n${index}</name><cur>${index % 3 === 0 ? "TRY" : "EUR"}</cur><amount>${index}.50</amount></entry>`,
  ).join("")}</catalogue>`;

const nested = (levels, cells) =>
  `${"<wrapper>".repeat(levels)}${Array.from(
    { length: cells },
    (_, index) => `<cell>v${index}</cell>`,
  ).join("")}${"</wrapper>".repeat(levels)}`;

const pathological = (count) =>
  `<w>${Array.from({ length: count }, (_, index) => `<i k="${index}"><j/></i>`).join("")}</w>`;

await writeFile(join(root, "wide.xml"), `${wide(4000)}\n`, "utf8");
await writeFile(join(root, "shallow.xml"), `${nested(1, 400)}\n`, "utf8");
await writeFile(join(root, "deep.xml"), `${nested(60, 400)}\n`, "utf8");
await writeFile(join(root, "hard.xml"), `${pathological(9000)}\n`, "utf8");

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

const bodyOf = (result) => JSON.parse(result.content[0].text);

const plain = (localName) => ({ namespaceUri: "", localName });

const timed = async (run) => {
  const started = process.hrtime.bigint();
  const result = await run();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { result, elapsedMs };
};

console.log("## M20 address derivation cost for a node-set page");
for (const [file, expression] of [
  ["wide.xml", "//name"],
  ["shallow.xml", "//cell"],
  ["deep.xml", "//cell"],
]) {
  const { result, elapsedMs } = await timed(() =>
    handlers.select_xpath({
      filePath: file,
      xpath: expression,
      maxResults: 200,
    }),
  );
  const body = bodyOf(result);
  console.log(
    `${file.padEnd(13)} members=${String(body.returnedCount).padStart(3)} total=${String(body.totalMembers).padStart(4)} bytes=${String(bytesOf(result)).padStart(7)} perMember=${Math.round(bytesOf(result) / Math.max(1, body.returnedCount))} elapsed=${elapsedMs.toFixed(1)}ms reason=${body.truncationReason ?? "none"}`,
  );
}

console.log();
console.log("## M23 bytes per row and per group");
const rowsPage = await handlers.project_records({
  filePath: "wide.xml",
  itemAddress: { ancestors: [plain("catalogue")], name: plain("entry") },
  columns: [
    {
      label: "code",
      value: { from: "attribute", namespaceUri: "", localName: "code" },
    },
    { label: "name", name: plain("name") },
    { label: "cur", name: plain("cur") },
    { label: "amount", name: plain("amount") },
  ],
  maxRows: 200,
});
const rowsBody = bodyOf(rowsPage);
console.log(
  `rows        returned=${rowsBody.returnedRows} matched=${rowsBody.matchedItems} bytes=${bytesOf(rowsPage)} perRow=${Math.round(bytesOf(rowsPage) / rowsBody.returnedRows)} reason=${rowsBody.truncationReason ?? "none"}`,
);

const groupsPage = await handlers.aggregate_document({
  filePath: "wide.xml",
  itemAddress: { ancestors: [plain("catalogue")], name: plain("entry") },
  columns: [
    { label: "cur", name: plain("cur") },
    { label: "amount", name: plain("amount") },
  ],
  groupBy: ["cur"],
  metrics: [{ fn: "count" }, { fn: "sum", column: "amount" }],
  numericMode: "binary64",
  maxGroups: 200,
});
const groupsBody = bodyOf(groupsPage);
console.log(
  `groups      returned=${groupsBody.returnedGroups} total=${groupsBody.groupCount} bytes=${bytesOf(groupsPage)} perGroup=${Math.round(bytesOf(groupsPage) / Math.max(1, groupsBody.returnedGroups))}`,
);

const manyGroups = await handlers.aggregate_document({
  filePath: "wide.xml",
  itemAddress: { ancestors: [plain("catalogue")], name: plain("entry") },
  columns: [{ label: "name", name: plain("name") }],
  groupBy: ["name"],
  metrics: [{ fn: "count" }],
  maxGroups: 200,
});
const manyBody = bodyOf(manyGroups);
console.log(
  `distinct    returned=${manyBody.returnedGroups} total=${manyBody.groupCount} bytes=${bytesOf(manyGroups)} perGroup=${Math.round(bytesOf(manyGroups) / Math.max(1, manyBody.returnedGroups))} reason=${manyBody.truncationReason ?? "none"}`,
);

console.log();
console.log("## M23b rows in a deep document, where read_node pays per record");
const deepRows = await handlers.project_records({
  filePath: "deep.xml",
  itemAddress: {
    ancestors: Array.from({ length: 60 }, () => plain("wrapper")),
    name: plain("cell"),
  },
  columns: [{ label: "value" }],
  maxRows: 200,
});
const deepBody = bodyOf(deepRows);
const rowsOnly = Buffer.byteLength(JSON.stringify(deepBody.rows), "utf8");
console.log(
  `deep rows   returned=${deepBody.returnedRows} bytes=${bytesOf(deepRows)} rowsArray=${rowsOnly} perRow=${Math.round(rowsOnly / deepBody.returnedRows)} parentAddress=${Buffer.byteLength(JSON.stringify(deepBody.itemParentAddress), "utf8")}`,
);

console.log();
console.log("## M24 a pathological expression against the time budget");
const beforeKill = bodyOf(
  await handlers.select_xpath({
    filePath: "wide.xml",
    xpath: "//name",
    maxResults: 40,
  }),
);
const generationBefore = pool.generation;
const hard = await timed(() =>
  handlers.select_xpath({
    filePath: "hard.xml",
    xpath: "//i[count(//j) > 0][count(//i) > 0]",
    maxResults: 5,
  }),
);
const hardBody = bodyOf(hard.result);
console.log(
  `pathological isError=${hard.result.isError === true} code=${hardBody.error ?? "none"} elapsed=${hard.elapsedMs.toFixed(0)}ms generation ${generationBefore} -> ${pool.generation} terminations=${pool.stats().terminations}`,
);

const survived = await timed(() =>
  handlers.select_xpath({
    filePath: "wide.xml",
    xpath: "//name",
    maxResults: 40,
    cursor: beforeKill.nextCursor,
  }),
);
const survivedBody = bodyOf(survived.result);
console.log(
  `old cursor  isError=${survived.result.isError === true} offset=${survivedBody.offset ?? "none"} returned=${survivedBody.returnedCount ?? 0} elapsed=${survived.elapsedMs.toFixed(0)}ms spawns=${pool.stats().spawns}`,
);

const again = await timed(() =>
  handlers.select_xpath({
    filePath: "wide.xml",
    xpath: "//name",
    maxResults: 40,
    cursor: survivedBody.nextCursor,
  }),
);
const againBody = bodyOf(again.result);
console.log(
  `next page   offset=${againBody.offset} returned=${againBody.returnedCount} elapsed=${again.elapsedMs.toFixed(0)}ms`,
);

await pool.close();
cache.clear();
await rm(root, { recursive: true, force: true });
