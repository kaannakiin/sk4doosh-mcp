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

for (const dir of [
  "naming",
  "metadata-extraction",
  "argument-mapping",
  "selection",
  "visibility",
  "search",
  "error-mapping",
  "schema-simplification",
  "card",
]) {
  let files = [];
  try {
    files = readdirSync(path.join(here, dir)).filter((f) =>
      f.endsWith(".json"),
    );
  } catch {
    continue;
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
