import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(here, "../../../packages/spec/schemas");
const outDir = path.resolve(here, "../src/SkMcp.AspNetCore/Generated");
const specVersion = JSON.parse(
  readFileSync(
    path.resolve(here, "../../../packages/spec/package.json"),
    "utf8",
  ),
).version;

const sources = [
  "endpoint-descriptor.schema.json",
  "tool-definition.schema.json",
  "invoke-result.schema.json",
  "type-shape.schema.json",
];

const inlineTypes = { JsonSchemaObject: "JsonObject" };

const readSchema = (file) =>
  JSON.parse(readFileSync(path.join(schemasDir, file), "utf8"));

const schemas = new Map(sources.map((file) => [file, readSchema(file)]));

const pascal = (name) =>
  name.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, __, ch) =>
    ch.toUpperCase(),
  );

function refTypeName(ref, currentFile) {
  const [file, pointer] = ref.split("#");
  const target = file === "" ? currentFile : file;
  if (!pointer || pointer === "/") {
    return schemas.get(target).title;
  }
  const key = pointer.replace("/$defs/", "");
  const def = schemas.get(target).$defs[key];
  return def.title ?? key;
}

function csharpType(schema, currentFile) {
  if (schema.$ref) {
    const name = refTypeName(schema.$ref, currentFile);
    return inlineTypes[name] ?? name;
  }
  if (schema.type === "array") {
    return `IReadOnlyList<${csharpType(schema.items, currentFile)}>`;
  }
  if (schema.type === "boolean") {
    return "bool";
  }
  if (schema.type === "integer") {
    return "int";
  }
  if (schema.type === "number") {
    return "double";
  }
  if (schema.type === "string" || schema.const !== undefined) {
    return "string";
  }
  if (schema.type === undefined) {
    return "JsonNode";
  }
  if (schema.type === "object") {
    if (schema.patternProperties) {
      const value = Object.values(schema.patternProperties)[0];
      return `IReadOnlyDictionary<string, ${csharpType(value, currentFile)}>`;
    }
    return "JsonObject";
  }
  throw new Error(`Unsupported schema node: ${JSON.stringify(schema)}`);
}

function emitEnum(name, schema) {
  const members = schema.enum.map((value) => `${pascal(value)}`).join(", ");
  return `public enum ${name} { ${members} }`;
}

function emitRecord(name, schema, currentFile) {
  const required = new Set(schema.required ?? []);
  const lines = [`public sealed record ${name}`, "{"];
  for (const [property, node] of Object.entries(schema.properties)) {
    const type = csharpType(node, currentFile);
    const modifier = required.has(property) ? "required " : "";
    const suffix = required.has(property) ? "" : "?";
    lines.push(
      `    public ${modifier}${type}${suffix} ${pascal(property)} { get; init; }`,
    );
  }
  lines.push("}");
  return lines.join("\n");
}

const emitted = new Map();
const shapes = new Map();

for (const [file, schema] of schemas) {
  const candidates = [
    [schema.title, schema],
    ...Object.entries(schema.$defs ?? {}).map(([key, def]) => [
      def.title ?? key,
      def,
    ]),
  ];
  for (const [name, node] of candidates) {
    if (inlineTypes[name]) {
      continue;
    }
    const shape = JSON.stringify(node);
    if (shapes.has(name)) {
      if (shapes.get(name) !== shape) {
        throw new Error(
          `Duplicate type name '${name}' with a different shape (second occurrence in ${file}). ` +
            `The emitter would silently keep the first one. Rename one of them.`,
        );
      }
      continue;
    }
    shapes.set(name, shape);
    if (emitted.has(name)) {
      continue;
    }
    if (node.type === "string" && Array.isArray(node.enum)) {
      emitted.set(name, emitEnum(name, node));
      continue;
    }
    if (node.type !== "object") {
      continue;
    }
    emitted.set(name, emitRecord(name, node, file));
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, "Spec.cs"),
  [
    "using System.Text.Json.Nodes;",
    "",
    "namespace SkMcp.AspNetCore.Spec;",
    "",
    `public static class SkMcpSpec\n{\n    public const string Version = "${specVersion}";\n}`,
    "",
    [...emitted.values()].join("\n\n"),
    "",
  ].join("\n"),
);
