import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { FileSourceError, redactRoot, type ErrorContext } from "./errors.js";

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

export function toToolError(
  error: FileSourceError,
  context: ErrorContext = {},
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: error.code,
          message: redactRoot(error.message, context.root),
          ...(error.recovery === undefined
            ? {}
            : { recovery: redactRoot(error.recovery, context.root) }),
        }),
      },
    ],
    isError: true,
  };
}

export function guard<D extends ToolDefinitions, K extends ToolNameOf<D>>(
  context: ErrorContext & { readonly tool: K },
  handler: (
    args: ToolInputOf<D, K>,
    tool: K,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
  normalize: ErrorNormalizer,
): GuardedHandler<D, K> {
  const guarded = async (
    args: ToolInputOf<D, K>,
    extra?: { readonly signal?: AbortSignal },
  ): Promise<CallToolResult> => {
    try {
      return await handler(args, context.tool, extra?.signal);
    } catch (error) {
      if (!(error instanceof FileSourceError)) {
        const raw =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        process.stderr.write(`${context.tool}: ${raw}\n`);
      }
      return toToolError(normalize(error, context), context);
    }
  };
  return Object.assign(guarded, { guardedTool: context.tool });
}
