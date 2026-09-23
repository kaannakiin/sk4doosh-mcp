import { mcpCoreLimits } from "@sk-mcp/mcp-core";

/**
 * Guard: Ollama never refuses an oversized prompt — 84,608 characters sent to a
 * 16k window came back as 8,194 processed tokens with the head silently dropped
 * (docs/llm-mcp-plani.md, rule 4). The server counts before it sends, and 45%
 * of the window is the input budget, leaving the rest for the system prompt and
 * the answer. Turkish text measured ~1.8 characters per token; English runs
 * near 4, so the estimate errs towards refusing, never towards truncating.
 */
export const limits = {
  ...mcpCoreLimits,
  inputBudgetRatio: 0.45,
  charsPerToken: 1.8,
  outputBudgetRatio: 0.4,
  maxBytesPerChar: 4,
} as const;

export function inputBudgetTokens(contextTokens: number): number {
  return Math.floor(contextTokens * limits.inputBudgetRatio);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / limits.charsPerToken);
}

/**
 * Guard: without an id-bearing schema the model was measured looping into
 * 12,600 tokens of garbage (docs/llm-mcp-plani.md, rule 8). A ceiling on the
 * answer ends such a loop inside the window instead of at the timeout.
 */
export function outputBudgetTokens(contextTokens: number): number {
  return Math.floor(contextTokens * limits.outputBudgetRatio);
}

/**
 * The largest input that could still fit the budget: a character is at most
 * four UTF-8 bytes, so anything bigger is refused before it is read.
 */
export function maxReadableBytes(contextTokens: number): number {
  return Math.floor(
    inputBudgetTokens(contextTokens) *
      limits.charsPerToken *
      limits.maxBytesPerChar,
  );
}
