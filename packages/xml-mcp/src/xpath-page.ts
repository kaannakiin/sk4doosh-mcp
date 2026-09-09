import {
  createPageBudget,
  measureJson,
  type Fingerprint,
} from "@sk-mcp/file-core";
import { cursorTtlMs, encodePosition } from "./cursor.js";
import { SkMcpXmlError } from "./errors.js";
import { limits } from "./limits.js";
import type { NodeSetMember, NumberKind, XPathOutcome } from "./query-model.js";
import {
  emptyResultDiagnostic,
  type QueryDiagnostic,
} from "./xpath-diagnosis.js";

const cursorSlackBytes = 32;

export type XPathTruncation = "maxResults" | "maxPayloadBytes";

interface EnvelopeHead {
  readonly filePath: string;
  readonly snapshotId: string;
}

export interface NodeSetEnvelope extends EnvelopeHead {
  readonly resultType: "nodeset";
  readonly members: readonly NodeSetMember[];
  readonly returnedCount: number;
  readonly totalMembers: number;
  readonly offset: number;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: XPathTruncation;
  readonly nextCursor?: string;
  readonly hint?: string;
  readonly diagnostics?: readonly QueryDiagnostic[];
}

export type XPathEnvelope =
  | (EnvelopeHead & {
      readonly resultType: "boolean";
      readonly value: boolean;
      readonly complete: true;
      readonly truncated: false;
    })
  | (EnvelopeHead & {
      readonly resultType: "string";
      readonly value: string;
      readonly complete: true;
      readonly truncated: boolean;
      readonly truncationReason?: "maxStringChars";
    })
  | (EnvelopeHead & {
      readonly resultType: "number";
      readonly numberKind: NumberKind;
      readonly value: number | null;
      readonly valueText: string;
      readonly complete: true;
      readonly truncated: false;
    })
  | NodeSetEnvelope;

export interface AssembleXPathInput {
  readonly filePath: string;
  readonly snapshotId: Fingerprint;
  readonly optionsHash: string;
  readonly expression: string;
  readonly rootNamespaceUri: string;
  readonly outcome: XPathOutcome;
}

const hint =
  "More members remain in this node-set. Pass nextCursor to continue; the expression is evaluated again for each page.";

export function assembleXPath(input: AssembleXPathInput): XPathEnvelope {
  const { outcome, snapshotId } = input;
  const head: EnvelopeHead = { filePath: input.filePath, snapshotId };

  if (outcome.resultType === "boolean") {
    return {
      ...head,
      resultType: "boolean",
      value: outcome.value,
      complete: true,
      truncated: false,
    };
  }
  if (outcome.resultType === "string") {
    return {
      ...head,
      resultType: "string",
      value: outcome.value,
      complete: true,
      truncated: outcome.truncated === true,
      ...(outcome.truncated === true
        ? { truncationReason: "maxStringChars" as const }
        : {}),
    };
  }
  if (outcome.resultType === "number") {
    return {
      ...head,
      resultType: "number",
      numberKind: outcome.numberKind,
      value: outcome.value,
      valueText: outcome.valueText,
      complete: true,
      truncated: false,
    };
  }

  const cursorAt = (position: number): string =>
    encodePosition(snapshotId, {
      t: "xpath",
      i: position,
      o: input.optionsHash,
      x: Date.now() + cursorTtlMs,
    });

  const reserveBytes =
    measureJson({
      ...head,
      resultType: "nodeset",
      members: [],
      returnedCount: outcome.members.length,
      totalMembers: outcome.totalMembers,
      offset: outcome.offset,
      complete: false,
      truncated: true,
      truncationReason: "maxPayloadBytes",
      nextCursor: cursorAt(outcome.offset + outcome.members.length),
      hint,
    }) + cursorSlackBytes;

  const budget = createPageBudget({
    maxBytes: limits.maxPayloadBytes,
    reserveBytes,
  });

  const admitted: NodeSetMember[] = [];
  let refused = false;
  for (const member of outcome.members) {
    if (budget.admit(member)) {
      admitted.push(member);
      continue;
    }
    refused = true;
    break;
  }

  if (admitted.length === 0 && outcome.members.length > 0) {
    throw new SkMcpXmlError(
      "resource_limit",
      `The first member of the node-set does not fit in the ${String(limits.maxPayloadBytes)} byte response budget.`,
      "Select fewer nodes, or address a narrower part of the document.",
    );
  }

  const consumed = outcome.offset + admitted.length;
  const complete = consumed >= outcome.totalMembers;
  const truncationReason: XPathTruncation | undefined = complete
    ? undefined
    : refused
      ? "maxPayloadBytes"
      : "maxResults";
  const diagnostic =
    outcome.totalMembers === 0
      ? emptyResultDiagnostic(input.expression, input.rootNamespaceUri)
      : undefined;

  return {
    ...head,
    resultType: "nodeset",
    members: admitted,
    returnedCount: admitted.length,
    totalMembers: outcome.totalMembers,
    offset: outcome.offset,
    complete,
    truncated: !complete,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(complete ? {} : { nextCursor: cursorAt(consumed), hint }),
    ...(diagnostic === undefined ? {} : { diagnostics: [diagnostic] }),
  };
}
