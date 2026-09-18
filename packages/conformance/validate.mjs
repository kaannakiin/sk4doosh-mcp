import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(here, "../spec/schemas");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const ajv = new Ajv2020.default({ allErrors: true, strict: true });
addFormats.default(ajv);
ajv.addSchema(
  readJson(path.join(schemasDir, "endpoint-descriptor.schema.json")),
);
ajv.addSchema(readJson(path.join(schemasDir, "tool-definition.schema.json")));
ajv.addSchema(readJson(path.join(schemasDir, "invoke-result.schema.json")));
ajv.addSchema(readJson(path.join(schemasDir, "type-shape.schema.json")));
const validate = ajv.compile(
  readJson(path.join(schemasDir, "fixture.schema.json")),
);

let checked = 0;
let failed = 0;

const expectedKinds = [
  "argument-mapping",
  "card",
  "detail",
  "error-mapping",
  "metadata-extraction",
  "naming",
  "schema-simplification",
  "search",
  "selection",
  "visibility",
];

/**
 * The kind list is derived from disk and compared with `expectedKinds` in both directions: a
 * hardcoded list alone let a whole directory stop being validated the moment it was renamed, and
 * the previous `catch { continue }` swallowed exactly that. A new kind must be declared here, and
 * a declared kind must exist.
 */
const presentKinds = readdirSync(here, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules",
  )
  .map((entry) => entry.name)
  .sort();

for (const kind of expectedKinds) {
  if (!presentKinds.includes(kind)) {
    console.error(`FAIL missing fixture directory: ${kind}`);
    failed += 1;
  }
}
for (const kind of presentKinds) {
  if (!expectedKinds.includes(kind)) {
    console.error(`FAIL undeclared fixture directory: ${kind}`);
    failed += 1;
  }
}

for (const dir of expectedKinds.filter((kind) => presentKinds.includes(kind))) {
  const files = readdirSync(path.join(here, dir)).filter((f) =>
    f.endsWith(".json"),
  );
  if (files.length === 0) {
    console.error(`FAIL empty fixture directory: ${dir}`);
    failed += 1;
  }
  for (const file of files) {
    const rel = path.join(dir, file);
    checked += 1;
    if (!validate(readJson(path.join(here, rel)))) {
      failed += 1;
      console.error(`FAIL ${rel}`);
      for (const err of validate.errors ?? []) {
        console.error(`  ${err.instancePath || "/"} ${err.message}`);
      }
    }
  }
}

console.log(`${checked} fixture(s) checked, ${failed} failed`);
if (failed > 0 || checked === 0) process.exit(1);
