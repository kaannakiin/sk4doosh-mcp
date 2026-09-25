/**
 * The `AGENTS.md` written into every workspace when a local worker is bound.
 *
 * Guard: without this file codex never called the local model at all. It
 * names only tools the server exposes today; naming one it does not would
 * send the agent after a tool that is not there. The sample-first line is
 * measured: a blind `local_map` instruction got 2 of 14 days right, a
 * sample-informed one 14 of 14.
 */
export const DELEGATION_INSTRUCTIONS = `# Delegation

You plan and verify. A free local model is reachable through the gateway as the \`local\` server: its tools are \`local_task\` and \`local_map\`, called with \`call_tool\` like every other tool. Delegate language judgement to it.

- Tabular data with clear patterns: you may write a script instead of delegating.
- Row-wise judgement that needs language understanding: first read a small sample (about 20 rows), then call \`local_map\` with the file path and a precise instruction that names the cues you saw. It writes the labelled copy itself and returns its path.
- \`local_map\` returns sample rows per label. Check them against your intent before using the output; if they are wrong, sharpen the instruction and run it again.
- One bounded language task (classify, extract, summarize, transform): call \`local_task\`. Pass text and CSV files by name in \`files\` rather than pasting them. Pass \`jsonSchema\` when you need structured output.
- Long documents: call \`local_task\` with \`kind\` summarize or extract and the file path, one call per document; it splits large inputs itself and reads all of it. Do not also read a document you delegated; if the answer misses something, ask \`local_task\` a narrower question about it.
- File arguments are names in ./files, exactly as the reader tools take them.
- The local tools read UTF-8 text and CSV only; they cannot open .xlsx, .xml or .pdf. For those, pass what you already read through \`text\` when it is short, or write the rows you need to a .csv in ./files and pass its name.
- If a local tool answers \`input_too_large\`, split the input and call it once per part, or do the work yourself.
- Keep for yourself: planning, arithmetic, aggregation, writing output files, the final answer.
- If a local call fails, retry once, then do the work yourself.
`;
