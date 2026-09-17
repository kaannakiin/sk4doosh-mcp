import {
  codexTaskOutputSchema,
  type CodexTaskOutput,
} from "@chat/contracts/tools/codex/task";

/**
 * Reads a coding agent's output off a tool part, or nothing when the part
 * belongs to another tool.
 *
 * Guard: recognised by shape rather than by tool name. The name is a string the
 * part carries for display, while this is what decides which renderer runs — and
 * a part whose output does not match the contract is better shown as raw text
 * than as a progress card built from fields that are not there.
 */
export function codexOutputOf(output: unknown): CodexTaskOutput | undefined {
  if (!isPhased(output)) {
    return undefined;
  }

  const parsed = codexTaskOutputSchema.safeParse(output);

  return parsed.success ? parsed.data : undefined;
}

function isPhased(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    "phase" in output &&
    typeof (output as { phase: unknown }).phase === "string"
  );
}
