import { mcpCoreLimits } from "@liaiso/mcp-core";

/**
 * Guard: Ollama never refuses an oversized prompt — 84,608 characters sent to a
 * 16k window came back as 8,194 processed tokens with the head silently
 * dropped. The server counts before it sends, and 45% of the window is the
 * input budget, leaving the rest for the system prompt and the answer.
 * Turkish text measured ~1.8 characters per token; English runs near 4, so
 * the estimate errs towards refusing, never towards truncating.
 *
 * Guard: labelling was measured at ~16 output tokens and ~270 ms per row.
 * 2,000 rows is about nine minutes, inside the 900 s tool timeout codex is
 * given; a larger file is refused up front rather than timed out halfway with
 * nothing written.
 *
 * Guard: a long summarize or extract runs one call per chunk plus the merge.
 * Seventeen documents were measured clearing the queue in 157 s, so 32 chunks
 * and three merge rounds stay inside the same 900 s; a larger input is
 * refused before the first call.
 */
export const limits = {
  ...mcpCoreLimits,
  inputBudgetRatio: 0.45,
  charsPerToken: 1.8,
  outputBudgetRatio: 0.4,
  maxBytesPerChar: 4,
  outputTokensPerRow: 17,
  maxMapRows: 2_000,
  maxMapBytes: 8 * 1024 * 1024,
  maxLongInputBytes: 1024 * 1024,
  maxChunks: 32,
  maxReduceRounds: 3,
} as const;

export function inputBudgetTokens(contextTokens: number): number {
  return Math.floor(contextTokens * limits.inputBudgetRatio);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / limits.charsPerToken);
}

/**
 * Guard: without an id-bearing schema the model was measured looping into
 * 12,600 tokens of garbage. A ceiling on the answer ends such a loop inside
 * the window instead of at the timeout.
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

/**
 * Characters one chunk may hold once a prompt of `overheadTokens` is added.
 */
export function chunkChars(
  contextTokens: number,
  overheadTokens: number,
): number {
  return Math.floor(
    (inputBudgetTokens(contextTokens) - overheadTokens) * limits.charsPerToken,
  );
}
