import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGatewayCatalog, configSchema, summarize } from "../src/index.js";

/**
 * Guard: the acceptance document is a real backend's internal API surface, so it never enters the
 * repository; this suite runs only when a path to it is given, and prints its report instead of
 * pinning a snapshot that would copy that surface into the tree.
 */
const documentPath = process.env["SKMCP_OPENAPI_ACCEPTANCE_DOC"];

describe.skipIf(documentPath === undefined || documentPath === "")(
  "acceptance: a real backend's document",
  () => {
    it("ingests without a fatal diagnostic and builds a catalog", async () => {
      const text = readFileSync(documentPath as string, "utf8");
      const config = configSchema.parse({
        source: documentPath,
        baseUrl: "http://127.0.0.1:12999",
        selection: { default: "include" },
        outputSchema: "document",
        hoistPathPrefix: "/Rest",
        requestBodyRequired: "always",
      });
      const gateway = await buildGatewayCatalog(
        text,
        config,
        new Map([["Bearer", { kind: "value", value: "unused" }]]),
        [],
        undefined,
        undefined,
      );
      const report = summarize(gateway.ingestion, gateway.catalog.diagnostics);
      process.stdout.write(
        [
          `operations: ${String(gateway.catalog.selected)} selected, ${String(gateway.catalog.entries.length)} tools`,
          ...report,
          ...gateway.catalog.fatal
            .slice(0, 20)
            .map((d) => `FATAL ${d.code}: ${d.message}`),
        ].join("\n") + "\n",
      );
      expect(gateway.ingestion.filter((d) => d.severity === "fatal")).toEqual(
        [],
      );
      expect(gateway.catalog.entries.length).toBeGreaterThan(0);
    });
  },
);
