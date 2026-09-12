import { toolFilePathSchema } from "@chat/contracts/tools/tool-file-path";
import type { ToolSet } from "ai";

export type Materializer = (filePath: string) => Promise<void>;

/**
 * Wraps a reader's tools so a file is fetched only when a call names it.
 *
 * Guard: materialization is wrapped around `execute`, not run while the tool set
 * is built. Two things fall out of that placement. It is the only point that
 * knows *which* file is needed — the path is right there in the input — so
 * opening a conversation costs no downloads at all. And the SDK resolves the
 * approval callback before it calls `execute`, so the object is fetched after the
 * user sanctioned the read: a confused model emitting eight tool calls in one
 * turn cannot turn itself into eight unapproved downloads.
 *
 * Guard: the tool is spread and only `execute` replaced, which keeps
 * `inputSchema`, `description` and `type` intact. Re-registering instead would
 * demote every part the interface renders from `tool-<name>` to `dynamic-tool`.
 */
export function withMaterialization(
  tools: ToolSet,
  materialize: Materializer,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute;
      if (execute === undefined) {
        return [name, tool];
      }

      return [
        name,
        {
          ...tool,
          execute: async (input: unknown, options: never) => {
            const parsed = toolFilePathSchema.safeParse(input);
            if (parsed.success) {
              await materialize(parsed.data.filePath);
            }

            return execute(input as never, options);
          },
        },
      ];
    }),
  ) as ToolSet;
}
