import { truncateWellFormed } from "@sk-mcp/file-core";
import { limits } from "./limits.js";
import type {
  OoxmlConditionalBlock,
  OoxmlConditionalRule,
  OoxmlThreshold,
} from "./ooxml/conditional-formats.js";
import {
  metadataLimitations,
  type MetadataLimitation,
} from "./metadata-support.js";

export interface ConditionalFormatThreshold {
  readonly type: string;
  readonly value?: number;
  readonly formula?: string;
  readonly unsupported?: true;
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
  readonly complete: false;
  readonly limitations: readonly MetadataLimitation[];
  readonly sheet: string;
  readonly count: number;
  readonly rules: readonly ConditionalFormatRule[];
  readonly rangesTruncated: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: "maxConditionalFormatRules";
  readonly hint?: string;
}

export function conditionalFormatRuleCountOf(
  blocks: readonly OoxmlConditionalBlock[],
): number {
  let total = 0;
  for (const block of blocks) {
    total += block.rules.length;
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
  cfvo: readonly OoxmlThreshold[] | undefined,
): ConditionalFormatThreshold[] | undefined {
  if (cfvo === undefined || cfvo.length === 0) {
    return undefined;
  }
  return cfvo.map((entry) => ({
    type: entry.type,
    ...(entry.formula === undefined
      ? {}
      : { formula: truncateWellFormed(entry.formula, limits.maxStringChars) }),
    ...(entry.value === undefined
      ? {}
      : Number.isFinite(entry.value)
        ? { value: entry.value }
        : { unsupported: true as const }),
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
  rule: OoxmlConditionalRule,
  ranges: readonly string[],
): ConditionalFormatRule {
  const rangesTruncated = ranges.length > limits.maxRangesPerRule;
  const thresholds = thresholdsOf(rule.cfvo);
  const formulae = formulaeOf(rule.formulae);
  return {
    ranges: rangesTruncated ? ranges.slice(0, limits.maxRangesPerRule) : ranges,
    rangesTruncated,
    type: rule.type,
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
  sheet: string,
  blocks: readonly OoxmlConditionalBlock[],
): ConditionalFormatReport {
  const flattened: ConditionalFormatRule[] = [];
  for (const block of blocks) {
    const ranges = splitRanges(block.ref);
    for (const rule of block.rules) {
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
  const unsupportedThresholds = kept.some((rule) =>
    rule.thresholds?.some((threshold) => threshold.unsupported === true),
  );
  return {
    sheet,
    count: flattened.length,
    rules: kept,
    complete: false,
    limitations: unsupportedThresholds ? [metadataLimitations.thresholds] : [],
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
