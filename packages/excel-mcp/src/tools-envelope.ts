import { measureJson, type SourceMode } from "@sk-mcp/file-core";
import type { CsvReport } from "./csv.js";

export const modeEnvelopeBytes = measureJson({ mode: "resident" });

export function withCsv<T extends object>(
  payload: T,
  report: CsvReport | undefined,
  mode: SourceMode,
): T & { mode: SourceMode; csv?: CsvReport } {
  return report === undefined
    ? { ...payload, mode }
    : { ...payload, csv: report, mode };
}

export function withMode<T extends object>(
  payload: T,
  mode: SourceMode,
): T & { mode: SourceMode } {
  return { ...payload, mode };
}
