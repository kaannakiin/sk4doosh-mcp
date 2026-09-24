import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EndpointDescriptor } from "@sk-mcp/core";
import { ingest } from "@sk-mcp/openapi";
import { describe, expect, it } from "vitest";

/**
 * Compares OpenAPI ingestion with framework discovery on the same controllers. The inputs are
 * written by sdks/dotnet/tests/SkMcp.Tests/OpenApiParityDump.cs into SKMCP_PARITY_DIR.
 */
const directory = process.env["SKMCP_PARITY_DIR"];

/**
 * Differences a document cannot avoid: the generator omits a fact the SDK reads from the type.
 */
const expectedDifferences = new Map([
  [
    "PUT /schema/audited",
    "a getter-only property is readOnly to the SDK; Microsoft.AspNetCore.OpenApi does not mark it",
  ],
]);

const normalizeRoute = (route: string): string =>
  route.replace(/\{([^}:?*]+)[^}]*\}/g, "{$1}").replace(/\/+$/, "") || "/";

function shapeOf(descriptor: EndpointDescriptor): Record<string, unknown> {
  const body = descriptor.requestBody;
  return {
    parameters: (descriptor.parameters ?? [])
      .map((p) => `${p.in}:${p.name}${p.required ? "!" : ""}`)
      .sort(),
    body:
      body === undefined
        ? null
        : {
            contentType: body.contentType ?? "application/json",
            required: body.required !== false,
            fields: Object.keys(body.schema.properties ?? {}).sort(),
          },
  };
}

describe.skipIf(directory === undefined || directory === "")(
  "parity: OpenAPI ingestion against framework discovery",
  () => {
    it("describes every SDK endpoint the same way", async () => {
      const dir = directory as string;
      const sdk = JSON.parse(
        readFileSync(join(dir, "sdk-descriptors.json"), "utf8"),
      ) as { tool: string; descriptor: EndpointDescriptor }[];
      const document = JSON.parse(
        readFileSync(join(dir, "openapi.json"), "utf8"),
      );
      const ingested = await ingest(document, {
        requestBodyRequired: "always",
        baseUrl: "http://localhost",
      });
      const byKey = new Map(
        ingested.endpoints.map((e) => [
          `${e.descriptor.method} ${normalizeRoute(e.descriptor.route)}`,
          e.descriptor,
        ]),
      );
      const report: string[] = [];
      const unexpected: string[] = [];
      let missing = 0;
      let differing = 0;
      for (const { tool, descriptor } of sdk) {
        const key = `${descriptor.method} ${normalizeRoute(descriptor.route)}`;
        const other = byKey.get(key);
        if (other === undefined) {
          missing += 1;
          report.push(`MISSING ${key} (${tool})`);
          continue;
        }
        const left = JSON.stringify(shapeOf(descriptor));
        const right = JSON.stringify(shapeOf(other));
        if (left !== right) {
          differing += 1;
          if (!expectedDifferences.has(key)) {
            unexpected.push(key);
          }
          report.push(
            `DIFF ${key} (${tool})\n  sdk:     ${left}\n  openapi: ${right}`,
          );
        }
      }
      process.stdout.write(
        [
          `sdk endpoints: ${String(sdk.length)}, ingested: ${String(ingested.endpoints.length)}, missing: ${String(missing)}, differing: ${String(differing)}`,
          ...report,
          ...ingested.diagnostics.map((d) => `diag ${d.code} ${d.at}`),
        ].join("\n") + "\n",
      );
      expect(missing).toBe(0);
      expect(unexpected).toEqual([]);
    });
  },
);
