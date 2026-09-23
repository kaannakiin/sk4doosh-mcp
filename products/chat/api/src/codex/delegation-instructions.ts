/**
 * The `AGENTS.md` written into every workspace when a local worker is bound.
 *
 * Guard: without this file codex never called the local model at all
 * (docs/llm-mcp-plani.md, rule 11). It names only tools the server exposes
 * today; naming one it does not would send the agent after a tool that is not
 * there.
 */
export const DELEGATION_INSTRUCTIONS = `# Delegation

You plan and verify. A free local model is available through the \`local\` MCP server; delegate bounded language work to it.

- One bounded language task (classify, extract, summarize, transform): call \`local_task\`. Pass file paths in \`files\`; never paste file contents. Pass \`jsonSchema\` when you need structured output.
- If \`local_task\` answers \`input_too_large\`, split the input into sections and call it once per section, or do the work yourself.
- Call \`local_status\` when you are unsure the local model is reachable.
- Keep for yourself: planning, arithmetic, aggregation, writing output files, the final answer.
- If a local call fails, retry once, then do the work yourself.
`;
