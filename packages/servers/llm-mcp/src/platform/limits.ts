import { mcpCoreLimits } from "@sk-mcp/mcp-core";

/**
 * Guard: Ollama never refuses an oversized prompt — 84,608 characters sent to a
 * 16k window came back as 8,194 processed tokens with the head silently dropped
 * (docs/llm-mcp-plani.md, rule 4). The server counts before it sends, and 45%
 * of the window is the input budget, leaving the rest for the system prompt and
 * the answer.
 */
export const limits = {
  ...mcpCoreLimits,
  inputBudgetRatio: 0.45,
} as const;

export function inputBudgetTokens(contextTokens: number): number {
  return Math.floor(contextTokens * limits.inputBudgetRatio);
}
