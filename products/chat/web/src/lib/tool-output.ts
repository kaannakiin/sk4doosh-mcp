interface TextBlock {
  type?: string;
  text?: string;
}

function textOf(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null || !("content" in output)) {
    return undefined;
  }

  const { content } = output as { content?: unknown };
  if (!Array.isArray(content)) {
    return undefined;
  }

  return (content as TextBlock[])
    .map((block) => block.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

/**
 * MCP tool results arrive as a content array whose single text block holds the
 * reader's JSON payload. Unwrapping and re-indenting it is the difference
 * between a readable result and an escaped one-line string.
 */
export function formatToolOutput(output: unknown): string {
  const text = textOf(output);
  if (text === undefined) {
    return JSON.stringify(output, null, 2);
  }

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function formatToolInput(input: unknown): [string, string][] {
  if (typeof input !== "object" || input === null) {
    return [];
  }

  return Object.entries(input as Record<string, unknown>).map(
    ([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ],
  );
}
