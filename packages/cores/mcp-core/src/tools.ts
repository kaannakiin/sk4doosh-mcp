import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import {
  McpSourceError,
  type ErrorContext,
  type ErrorFactory,
} from "./errors.js";
import { mcpCoreLimits } from "./limits.js";
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

export interface OwnOutputAnnotations extends ToolAnnotations {
  readonly readOnlyHint: false;
  readonly destructiveHint: false;
  readonly idempotentHint: false;
  readonly openWorldHint: false;
}

/**
 * Guard: these hints tell the client the tool only ever adds a new entry under the server's own
 * output location, which is why a client may auto-approve it. The core cannot write anything, so
 * the consumer carries the promise: create-only, a name it chooses itself, never outside that
 * location (docs/cikti-yazan-tool-karari.md).
 */
export const ownOutput: OwnOutputAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export interface OwnOutputToolDefinition {
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly annotations: ToolAnnotations & {
    readonly readOnlyHint: false;
    readonly destructiveHint: false;
  };
}

export type ToolCatalog = Readonly<
  Record<string, ReadOnlyToolDefinition | OwnOutputToolDefinition>
>;

export type ToolNameOf<D extends ToolCatalog> = keyof D & string;

export type ToolInputOf<
  D extends ToolCatalog,
  K extends ToolNameOf<D>,
> = z.infer<D[K]["inputSchema"]>;

export type GuardedHandler<D extends ToolCatalog, K extends ToolNameOf<D>> = ((
  args: ToolInputOf<D, K>,
  extra?: { readonly signal?: AbortSignal },
) => Promise<CallToolResult>) & {
  readonly guardedTool: K;
};

export type HandlersOf<D extends ToolCatalog> = {
  readonly [K in ToolNameOf<D>]: GuardedHandler<D, K>;
};

export type ErrorNormalizer = (
  error: unknown,
  context: ErrorContext,
) => McpSourceError;

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

/**
 * Renders an error as a bounded envelope.
 *
 * Guard: redaction runs before clamping, never after — clamping a redacted
 * string can only shorten it, whereas redacting a clamped one can leave a
 * half-written secret that no pattern matches any more.
 */
export function toToolError(
  error: McpSourceError,
  context: ErrorContext = {},
  maxBytes: number = mcpCoreLimits.maxPayloadBytes,
): CallToolResult {
  const redact = context.redact ?? ((detail: string): string => detail);
  const message = redact(error.message);
  const recovery =
    error.recovery === undefined ? undefined : redact(error.recovery);
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
  readonly fail: ErrorFactory<"resource_limit">;
  readonly maxBytes?: number;
}

/**
 * Wraps one tool handler so every outcome — success, thrown error, oversized
 * response — leaves as a bounded `CallToolResult`.
 *
 * Guard: the returned function carries the `guardedTool` brand, and
 * `HandlersOf` accepts nothing else. That is what makes the payload budget
 * unbypassable: a hand-written handler cannot be registered.
 */
export function guard<D extends ToolCatalog, K extends ToolNameOf<D>>(
  context: GuardContext<K>,
  handler: (
    args: ToolInputOf<D, K>,
    tool: K,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
  normalize: ErrorNormalizer,
): GuardedHandler<D, K> {
  const maxBytes = context.maxBytes ?? mcpCoreLimits.maxPayloadBytes;
  const guarded = async (
    args: ToolInputOf<D, K>,
    extra?: { readonly signal?: AbortSignal },
  ): Promise<CallToolResult> => {
    let result: CallToolResult;
    try {
      result = await handler(args, context.tool, extra?.signal);
    } catch (error) {
      if (!(error instanceof McpSourceError)) {
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
