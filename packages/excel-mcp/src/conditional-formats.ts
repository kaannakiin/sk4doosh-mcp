import { truncateWellFormed } from "@sk-mcp/file-core";
import type { Worksheet } from "exceljs";
import { limits } from "./limits.js";

export interface ConditionalFormatThreshold {
  readonly type: string;
  readonly value?: number;
}

export interface ConditionalFormatRule {
  readonly ranges: readonly string[];
  readonly rangesTruncated: boolean;
  readonly type: string;
  readonly priority?: number;
  readonly operator?: string;
  readonly formulae?: readonly string[];
  readonly timePeriod?: string;
  readonly iconSet?: string;
  readonly rank?: number;
  readonly percent?: boolean;
  readonly bottom?: boolean;
  readonly aboveAverage?: boolean;
  readonly thresholds?: readonly ConditionalFormatThreshold[];
}

export interface ConditionalFormatReport {
  readonly sheet: string;
  readonly count: number;
  readonly rules: readonly ConditionalFormatRule[];
  readonly rangesTruncated: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: "maxConditionalFormatRules";
  readonly hint?: string;
}

interface StoredThreshold {
  readonly type?: string;
  readonly value?: number;
}

interface StoredRule {
  readonly type?: string;
  readonly operator?: string;
  readonly priority?: number;
  readonly formulae?: readonly unknown[];
  readonly timePeriod?: string;
  readonly iconSet?: string;
  readonly rank?: number;
  readonly percent?: boolean;
  readonly bottom?: boolean;
  readonly aboveAverage?: boolean;
  readonly cfvo?: readonly StoredThreshold[];
}

export interface StoredConditionalFormat {
  readonly ref?: string;
  readonly rules?: readonly StoredRule[];
}

interface ConditionalFormatHost {
  readonly conditionalFormattings?: readonly StoredConditionalFormat[] | null;
}

export function conditionalFormatsOf(
  worksheet: Worksheet,
): readonly StoredConditionalFormat[] {
  return (
    (worksheet as Worksheet & ConditionalFormatHost).conditionalFormattings ??
    []
  );
}

export function conditionalFormatRuleCountOf(worksheet: Worksheet): number {
  let total = 0;
  for (const block of conditionalFormatsOf(worksheet)) {
    total += block.rules?.length ?? 0;
  }
  return total;
}

function splitRanges(ref: string | undefined): string[] {
  if (ref === undefined) {
    return [];
  }
  return ref.split(/\s+/).filter((range) => range !== "");
}

function thresholdsOf(
  cfvo: readonly StoredThreshold[] | undefined,
): ConditionalFormatThreshold[] | undefined {
  if (cfvo === undefined || cfvo.length === 0) {
    return undefined;
  }
  return cfvo
    .filter(
      (entry): entry is StoredThreshold & { type: string } =>
        typeof entry.type === "string",
    )
    .map((entry) => ({
      type: entry.type,
      ...(entry.value === undefined ? {} : { value: entry.value }),
    }));
}

function formulaeOf(
  formulae: readonly unknown[] | undefined,
): string[] | undefined {
  if (formulae === undefined || formulae.length === 0) {
    return undefined;
  }
  return formulae
    .filter((entry) => entry !== undefined && entry !== null)
    .map((entry) => truncateWellFormed(String(entry), limits.maxStringChars));
}

function project(
  rule: StoredRule,
  ranges: readonly string[],
): ConditionalFormatRule {
  const rangesTruncated = ranges.length > limits.maxRangesPerRule;
  const thresholds = thresholdsOf(rule.cfvo);
  const formulae = formulaeOf(rule.formulae);
  return {
    ranges: rangesTruncated ? ranges.slice(0, limits.maxRangesPerRule) : ranges,
    rangesTruncated,
    type: rule.type ?? "unknown",
    ...(rule.priority === undefined ? {} : { priority: rule.priority }),
    ...(rule.operator === undefined ? {} : { operator: rule.operator }),
    ...(formulae === undefined ? {} : { formulae }),
    ...(rule.timePeriod === undefined ? {} : { timePeriod: rule.timePeriod }),
    ...(rule.iconSet === undefined ? {} : { iconSet: rule.iconSet }),
    ...(rule.rank === undefined ? {} : { rank: rule.rank }),
    ...(rule.percent === undefined ? {} : { percent: rule.percent }),
    ...(rule.bottom === undefined ? {} : { bottom: rule.bottom }),
    ...(rule.aboveAverage === undefined
      ? {}
      : { aboveAverage: rule.aboveAverage }),
    ...(thresholds === undefined ? {} : { thresholds }),
  };
}

export function collectConditionalFormats(
  worksheet: Worksheet,
): ConditionalFormatReport {
  const flattened: ConditionalFormatRule[] = [];
  for (const block of conditionalFormatsOf(worksheet)) {
    const ranges = splitRanges(block.ref);
    for (const rule of block.rules ?? []) {
      flattened.push(project(rule, ranges));
    }
  }
  flattened.sort((left, right) => {
    if (left.priority === right.priority) {
      return 0;
    }
    if (left.priority === undefined) {
      return 1;
    }
    if (right.priority === undefined) {
      return -1;
    }
    return left.priority - right.priority;
  });
  const truncated = flattened.length > limits.maxConditionalFormatRules;
  const kept = truncated
    ? flattened.slice(0, limits.maxConditionalFormatRules)
    : flattened;
  return {
    sheet: worksheet.name,
    count: flattened.length,
    rules: kept,
    rangesTruncated: kept.some((rule) => rule.rangesTruncated),
    truncated,
    ...(truncated
      ? {
          truncationReason: "maxConditionalFormatRules" as const,
          hint: `${flattened.length} rules apply to this sheet; the first ${limits.maxConditionalFormatRules} in priority order are listed. Call describe_workbook for the count on every sheet.`,
        }
      : {}),
  };
}
