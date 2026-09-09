import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import {
  FileSourceError,
  redactRoot,
  type CoreErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "./errors.js";
import { coreLimits } from "./limits.js";
import { clampJsonField, measureJson } from "./payload.js";

export interface ReadOnlyAnnotations extends ToolAnnotations {
  readonly readOnlyHint: true;
  readonly idempotentHint: true;
  readonly openWorldHint: false;
}

export const readOnly: ReadOnlyAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

export interface ReadOnlyToolDefinition {
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly annotations: ToolAnnotations & { readonly readOnlyHint: true };
}

export type ToolDefinitions = Readonly<Record<string, ReadOnlyToolDefinition>>;

export type ToolNameOf<D extends ToolDefinitions> = keyof D & string;

export type ToolInputOf<
  D extends ToolDefinitions,
  K extends ToolNameOf<D>,
> = z.infer<D[K]["inputSchema"]>;

export type GuardedHandler<
  D extends ToolDefinitions,
  K extends ToolNameOf<D>,
> = ((
  args: ToolInputOf<D, K>,
  extra?: { readonly signal?: AbortSignal },
) => Promise<CallToolResult>) & {
  readonly guardedTool: K;
};

export type HandlersOf<D extends ToolDefinitions> = {
  readonly [K in ToolNameOf<D>]: GuardedHandler<D, K>;
};

export type ErrorNormalizer = (
  error: unknown,
  context: ErrorContext,
) => FileSourceError;

export function json(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

interface ErrorEnvelope {
  readonly error: string;
  readonly message: string;
  readonly recovery?: string;
}

function errorResult(envelope: ErrorEnvelope): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    isError: true,
  };
}

export function toToolError(
  error: FileSourceError,
  context: ErrorContext = {},
  maxBytes: number = coreLimits.maxPayloadBytes,
): CallToolResult {
  const message = redactRoot(error.message, context.root);
  const recovery =
    error.recovery === undefined
      ? undefined
      : redactRoot(error.recovery, context.root);
  const shape = (text: string, tail: string | undefined): ErrorEnvelope => ({
    error: error.code,
    message: text,
    ...(tail === undefined ? {} : { recovery: tail }),
  });
  const full = shape(message, recovery);
  if (measureJson(full) <= maxBytes) {
    return errorResult(full);
  }
  const kept = shape(
    clampJsonField(message, maxBytes, (text) => shape(text, recovery)),
    recovery,
  );
  if (measureJson(kept) <= maxBytes) {
    return errorResult(kept);
  }
  return errorResult(
    shape(
      clampJsonField(message, maxBytes, (text) => shape(text, undefined)),
      undefined,
    ),
  );
}

function payloadBytes(result: CallToolResult): number {
  let total = 0;
  for (const block of result.content) {
    if (block.type === "text") {
      total += Buffer.byteLength(block.text, "utf8");
    }
  }
  return total;
}

export interface GuardContext<K extends string> extends ErrorContext {
  readonly tool: K;
  readonly fail: ErrorFactory<CoreErrorCode>;
  readonly maxBytes?: number;
}

export function guard<D extends ToolDefinitions, K extends ToolNameOf<D>>(
  context: GuardContext<K>,
  handler: (
    args: ToolInputOf<D, K>,
    tool: K,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
  normalize: ErrorNormalizer,
): GuardedHandler<D, K> {
  const maxBytes = context.maxBytes ?? coreLimits.maxPayloadBytes;
  const guarded = async (
    args: ToolInputOf<D, K>,
    extra?: { readonly signal?: AbortSignal },
  ): Promise<CallToolResult> => {
    let result: CallToolResult;
    try {
      result = await handler(args, context.tool, extra?.signal);
    } catch (error) {
      if (!(error instanceof FileSourceError)) {
        const raw =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        process.stderr.write(`${context.tool}: ${raw}\n`);
      }
      return toToolError(normalize(error, context), context, maxBytes);
    }
    const size = payloadBytes(result);
    if (size <= maxBytes) {
      return result;
    }
    return toToolError(
      context.fail(
        "resource_limit",
        `${context.tool} produced a ${size} byte response; the limit is ${maxBytes} bytes.`,
      ),
      context,
      maxBytes,
    );
  };
  return Object.assign(guarded, { guardedTool: context.tool });
}
