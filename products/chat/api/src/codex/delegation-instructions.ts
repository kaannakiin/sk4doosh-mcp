/**
 * The `AGENTS.md` written into every workspace when a local worker is bound.
 *
 * Guard: without this file codex never called the local model at all
 * (docs/llm-mcp-plani.md, rule 11). It names only tools the server exposes
 * today; naming one it does not would send the agent after a tool that is not
 * there.
 */
export const DELEGATION_INSTRUCTIONS = `# Delegation

You plan and verify. A free local model is available through the \`local\` MCP server.

- Call \`local_status\` to learn whether it is reachable and loaded, which model it runs, and how large an input one call may carry.
- Keep for yourself: planning, arithmetic, aggregation, writing output files, the final answer.
`;
