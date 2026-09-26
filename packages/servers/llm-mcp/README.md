# @liaiso/llm-mcp

MCP server that lets a planning agent (Codex, Claude Code, Cursor) hand off bounded language work to a local model. It builds on `@liaiso/mcp-core` and names no other `@liaiso/*` package.

## Quick start

```json
{
  "mcpServers": {
    "local": {
      "command": "npx",
      "args": ["liaiso-llm"],
      "env": {
        "LIAISO_LLM_BASE_URL": "http://127.0.0.1:11434",
        "LIAISO_LLM_MODEL": "qwen3:8b"
      }
    }
  }
}
```

In Codex, the same block goes under `mcp_servers.local`. If it runs with `approval_policy = "never"`, `default_tools_approval_mode = "auto"` is also required, or Codex refuses the call.

## Tools

Three tools. Two are read-only; `local_map` only adds new files to the server's own output directory.

| Tool           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Key arguments                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `local_task`   | Runs one bounded language task on the local model: `classify`, `extract`, `summarize`, `transform`, or `free`. The server reads any file arguments itself — their contents never enter the calling agent's context. With `jsonSchema` the answer is JSON matching that schema (returned as `result`); otherwise it is text (returned as `answer`). `summarize` and `extract` split an oversized input into chunks and read all of it (up to 32 chunks, 1 MiB total); every other kind refuses an oversized input as `input_too_large`. Nothing is ever silently truncated. | `kind`, `instruction`, `text?`, `files?` (up to 8, paths relative to the working directory), `jsonSchema?` |
| `local_map`    | Labels every row of a CSV file with one of the given labels. The agent never sees the rows: it passes a path, and the server writes a new file (the original columns plus one label column) under the output directory, returning that file's path, the per-label counts, and up to 4 sample rows per label. Up to 2,000 rows.                                                                                                                                                                                                                                             | `file`, `instruction`, `labels` (2–50), `labelColumn?` (defaults to `label`)                               |
| `local_status` | Reports whether the local model is reachable and loaded, its context window, one call's input budget, and how many calls are queued. Call it when unsure the local model is available before delegating to it.                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                       |

## Configuration

```text
LIAISO_LLM_MODEL=qwen3:8b
LIAISO_LLM_ROOT=.                            # default: the working directory
LIAISO_LLM_OUTPUT_DIR=.llm-mcp/out           # default; relative to root, must stay inside it
LIAISO_LLM_BASE_URL=http://127.0.0.1:11434   # default
LIAISO_LLM_NUM_CTX=16384                     # default; at least 4096
LIAISO_LLM_KEEP_ALIVE=30m                    # default
LIAISO_LLM_TIMEOUT_MS=300000                 # default; one request

npx liaiso-llm
```

| Variable                | Default                  | Meaning                                                                                                             |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `LIAISO_LLM_MODEL`      | none — required          | The Ollama model name. There is no built-in default; it must be set explicitly (see [Model choice](#model-choice)). |
| `LIAISO_LLM_ROOT`       | working directory        | Workspace root. Every file argument a tool accepts is resolved against it.                                          |
| `LIAISO_LLM_OUTPUT_DIR` | `.llm-mcp/out`           | Where `local_map` writes its output. Relative to the root, and must stay inside it.                                 |
| `LIAISO_LLM_BASE_URL`   | `http://127.0.0.1:11434` | Base URL of the Ollama host.                                                                                        |
| `LIAISO_LLM_NUM_CTX`    | `16384`                  | Context window in tokens. Must be an integer of at least 4096.                                                      |
| `LIAISO_LLM_KEEP_ALIVE` | `30m`                    | Value forwarded to Ollama's `keep_alive`.                                                                           |
| `LIAISO_LLM_TIMEOUT_MS` | `300000`                 | Timeout for a single request to the model.                                                                          |

Only the model name is required. Parsing is fatal, reaching the host is not: the server still starts and answers `tools/list` with the host down, and `local_status` reports `reachable: false`. The model is warmed up right after the server starts serving.

Set `LIAISO_LLM_NUM_CTX` to what the GPU actually delivers. Ollama does not refuse an oversized input — it silently drops the head — and the input budget is derived from this value.

## Limits

| Limit                                           | Value                        | Why                                                                                                                                   |
| ----------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Input budget                                    | 45% of the context window    | Ollama silently drops the head of an oversized prompt instead of refusing it, so the server refuses first.                            |
| Output budget                                   | 40% of the context window    | Caps a runaway completion; without an id-bearing schema the model was measured looping into 12,600 tokens of garbage.                 |
| Chars-per-token estimate                        | ~1.8                         | Measured on Turkish text; English runs closer to 4 characters per token, so the estimate errs toward refusing rather than truncating. |
| `local_task` `files`                            | up to 8                      | Per-call file argument cap.                                                                                                           |
| `local_task` long input (`summarize`/`extract`) | up to 32 chunks, 1 MiB total | Other kinds refuse an over-budget input outright as `input_too_large`.                                                                |
| Chunk merge rounds                              | up to 3                      | A merge that still does not fit after 3 rounds fails as `input_too_large`.                                                            |
| `local_map` rows                                | up to 2,000                  | Labelling was measured at ~270 ms per row — about nine minutes for 2,000 rows, inside the 900 s tool timeout Codex allows.            |
| `local_map` file size                           | up to 8 MiB                  | Refused up front rather than timed out halfway with nothing written.                                                                  |

## Rules

- **Three lint-enforced layers, three root entrypoints.** `src` splits into `platform/` (the mcp-core and Node boundary), `backend/` (the model host), and `tools/` (the MCP surface). `tools/` sees the host only through `backend/port.ts`; the concrete backend is wired in `cli.ts`.
- **Only `src/backend/ollama.ts` reaches the network**, and only through the global `fetch`. That global and the `node:http`/`net`/`tls` family are lint-banned everywhere else.
- **`process.env` is read only in `cli.ts`**, each variable accessed by name.
- **File paths are resolved against the workspace.** The requested path and its `realpath` are checked separately, so a symlink pointing outside the workspace is refused too. `readText` accepts only a `WorkspacePath`-branded path that has passed both checks. In error envelopes, the workspace's absolute path appears as `.`.
- **The server counts tokens, not the model.** An input over `num_ctx × 0.45` never reaches the host; an input that could not fit under any circumstances is refused before it is even read. The answer is capped at `num_ctx × 0.4`.
- **Only `src/platform/workspace.ts` touches the filesystem**, lint-enforced. The single writer is `createOutput`: it re-checks the output directory's `realpath`, the server itself picks the file name, lowers it to a safe alphabet and fixes the extension to `.csv`, and opens it `wx` — so it never overwrites an existing file or a symlink, and nothing is ever deleted ([mcp-core](../../cores/mcp-core/README.md#design-decisions)).
- **`local_map` carries the row number to the model and back.** An id-less format lost the row order. A skipped row is asked again once; if it is still missing, it is left unlabeled and counted — never guessed.
- **A chunked input is not truncated either.** Chunks split on paragraph, then line, boundaries; each chunk yields notes, the notes are merged and the instruction applied one last time. If the merged notes still do not fit the budget, the merge round repeats (up to 3); if that still fails, the call is refused as `input_too_large`.
- **One request per host at a time.** `createSerialBackend` queues requests: the GPU does not run them in parallel, while Codex fires calls concurrently. `probe` bypasses the queue.
- **A new backend kind is just another implementation of the `Backend` interface.** The rest of the server does not change.

## Design notes

The measurements below are what the rules above are built on.

### Why an MCP server instead of pointing Codex at Ollama directly

Four ways of getting Codex to a local model were tried; only the MCP server worked.

| Approach                 | Result                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex straight to Ollama | Ollama 0.34.2 serves `/v1/responses` and the connection succeeds, but the local model does not know Codex's tool protocol — it called a `Read` tool that does not exist, and Ollama answered the next request with `no user query found`. The real blocker: Codex starts every turn with a ~37k-token base cost, which does not fit a 16k context |
| Codex shell runs `curl`  | The sandbox cuts network access; opening it means giving Codex network access everywhere, not just to the local model                                                                                                                                                                                                                             |
| Codex's `spawn_agent`    | Accepts OpenAI models only                                                                                                                                                                                                                                                                                                                        |
| **MCP server**           | Runs outside the sandbox and reaches Ollama itself. Only the prompt reaches the local model (measured: 196 tokens) — Codex's ~37k-token turn overhead never leaves Codex                                                                                                                                                                          |

The server's working directory is Codex's workspace: every file argument the tools accept is resolved against it, and a path that resolves outside it is refused.

### Model choice

`gpt-oss:20b` was measured scoring 0/100 on the id-bearing JSON schema `local_map` and structured `local_task` calls depend on — the model could not hold the schema. A `qwen3` model (`qwen3:8b` in the examples above) is what the measurements in this repository were run with; `LIAISO_LLM_MODEL` has no built-in default, so it must be set explicitly.

### Codex alone on tabular data

On a 400-row labelling task with clear cues, Codex working alone was as accurate as delegating (14/14 correct) and about 3.5x faster: 48 s versus 166 s through `local_map`. This is why `DELEGATION_INSTRUCTIONS` (`products/chat/api/src/codex/delegation-instructions.ts`) allows Codex to write a script instead of delegating when the data is tabular with clear patterns — delegating only pays off on long or unstructured text, not on rows a script can already parse.

### Rejected alternatives

- **The name `ollama-mcp`.** Too narrow once the backend became pluggable; `llm-mcp` follows the repo's convention of naming a server after the resource behind it, not the current backend.
- **A private `products/chat/worker`.** The server has nothing chat-specific in it — tools take a file path and an instruction, schemas are plain JSON Schema on the MCP surface. Keeping it inside `products/chat` would close it to outside contribution and force reinventing the payload budget that `@liaiso/mcp-core` already provides.
- **Using an existing open-source repo.** Most of the ones reviewed are Python, and one carries a license that forbids modification; none of them know Codex's approval mode, its workspace boundary, or the payload budget. Ideas were borrowed where they held up: per-kind ready-made prompts (from `ollama-handoff`), file-path-taking tools and failover (from `LocalTokens`), and "the worker produces bounded output, the strong side accepts it" (from Shahriar/ollama-mcp-server).
- **One tool per job kind.** Every extra tool schema is token cost on every Codex turn; one `local_task` tool with a `kind` enum covers the same ground for less.
- **Raising concurrency instead of queueing.** Four parallel requests to one GPU were only 1.1x faster than four sequential ones — the GPU does not run requests in parallel, so a queue is the only thing that keeps a call inside its own timeout.

### Out of scope (deliberately)

- **An agent loop on the local model.** A reviewed repo's small model, run through a full agent harness, took 5–7 minutes on a simple task and once reported having done work it had not done. Agent work already has Codex's own `spawn_agent`.
- **Embedding.** `bge-m3` is available on the host but unused; add it if a search need appears.
- **Reading `.xlsx` directly.** v1 reads CSV and plain text only. An `.xlsx` input goes through `@liaiso/excel-mcp` from the calling side; teaching this server the format directly is out of scope for now.

### Measured runs

All Codex runs below used `gpt-5.6-luna` at `low` reasoning effort, against Ollama 0.34.2 with `num_ctx` 16,384. "Cache-free" is `input_tokens − cached_input_tokens`.

| Run | Data                | Setup                          | Time  | Cache-free input | Output | Result                                                                                                      |
| --- | ------------------- | ------------------------------ | ----- | ---------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| S0  | 400 rows, with cues | Codex alone                    | 53 s  | 31.1k            | 1.8k   | 14/14 days                                                                                                  |
| S1  | 400 rows, with cues | `local_task` only              | 68 s  | 32.5k            | 2.4k   | 14/14 (local call hit `input_too_large`, Codex fell back to Python)                                         |
| S2  | 400 rows, with cues | `local_map`, auto-approved     | 155 s | 41.4k            | 1.5k   | 14/14, Codex never read the rows                                                                            |
| H0  | 400 rows, no cues   | Codex alone                    | 48 s  | 25.8k            | 1.9k   | 14/14 (read 200 rows and wrote a rule)                                                                      |
| H2  | 400 rows, no cues   | `local_map`, blind instruction | 162 s | 18.4k            | 1.7k   | **2/14** (376/400 rows labelled)                                                                            |
| H3  | 400 rows, no cues   | `local_map`, sample + verify   | 166 s | 24.5k            | 2.2k   | 14/14 (400/400 rows labelled)                                                                               |
| D0  | 17 documents        | Codex alone                    | 65 s  | 34.1k            | 2.9k   | 17 records (read only the first 240 lines of each document)                                                 |
| D2  | 17 documents        | `local_task` + chunking        | 226 s | 25.7k            | 3.0k   | 17 records, Codex read no document itself; 17 calls arrived at once, the queue cleared in 157 s, no timeout |

## Development

```text
pnpm turbo run test --filter=@liaiso/llm-mcp
```

No local model is needed for this — `fetch` is faked.

`test/live.spec.ts` runs against a real Ollama instance:

```text
LIAISO_LLM_LIVE=1 LIAISO_LLM_BASE_URL=http://127.0.0.1:11434 LIAISO_LLM_MODEL=qwen3:8b \
  pnpm turbo run test --filter=@liaiso/llm-mcp -- test/live.spec.ts
```
