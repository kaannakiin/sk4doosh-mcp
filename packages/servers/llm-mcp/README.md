# @sk-mcp/llm-mcp

Planlayan bir ajanın (Codex, Claude Code, Cursor) sınırlı dil işlerini yerel bir modele devretmesini sağlayan MCP sunucusu. `@sk-mcp/mcp-core` üzerine kuruludur ve ondan başka hiçbir `@sk-mcp/*` paketi adlandırmaz. Tasarım kararları ve ölçümler için bkz. [Design notes and measurements](#design-notes-and-measurements) (İngilizce).

Üç tool. İkisi salt-okunur, `local_map` yalnızca sunucunun kendi çıktı klasörüne yeni dosya ekler:

| Tool                                                        | Ne yapar                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local_task(kind, instruction, text?, files?, jsonSchema?)` | Tek bir dil işi: `classify`, `extract`, `summarize`, `transform`, `free`. Dosyaları sunucu okur, içerikleri ajanın context'ine girmez. `jsonSchema` verilirse cevap o şemaya uyan JSON'dur (`result`), yoksa metindir (`answer`). `summarize` ve `extract` bütçeyi aşan girdiyi kendisi parçalar ve tamamını okur (en çok 32 parça, 1 MiB); diğer kind'lar `input_too_large` döner. Hiçbir girdi kesilmez |
| `local_map(file, instruction, labels, labelColumn?)`        | CSV'nin her satırını verilen etiketlerden biriyle etiketler. Ajan satırları görmez: yol verir, sunucu orijinal sütunlar + bir etiket sütunuyla yeni bir dosyayı `.llm-mcp/out/` altına yazar, dosyanın yolunu, etiket başına sayımları ve 4 örnek satırı döner. En çok 2.000 satır                                                                                                                        |
| `local_status()`                                            | Model erişilebilir ve yüklü mü, context penceresi, bir çağrının girdi bütçesi, kuyrukta bekleyen çağrı sayısı                                                                                                                                                                                                                                                                                             |

## Kurulum

```json
{
  "mcpServers": {
    "local": {
      "command": "npx",
      "args": ["sk-mcp-llm"],
      "env": {
        "SKMCP_LLM_BASE_URL": "http://127.0.0.1:11434",
        "SKMCP_LLM_MODEL": "qwen3:8b"
      }
    }
  }
}
```

Codex'te aynı blok `mcp_servers.local` altına yazılır. `approval_policy = "never"` ile koşuluyorsa `default_tools_approval_mode = "auto"` gerekir, yoksa codex çağrıyı reddeder.

## Çalıştırma

```text
SKMCP_LLM_MODEL=qwen3:8b
SKMCP_LLM_ROOT=.                            # varsayılan: çalışma dizini
SKMCP_LLM_OUTPUT_DIR=.llm-mcp/out           # varsayılan; köke göreli, kökün içinde olmalı
SKMCP_LLM_BASE_URL=http://127.0.0.1:11434   # varsayılan
SKMCP_LLM_NUM_CTX=16384                     # varsayılan; en az 4096
SKMCP_LLM_KEEP_ALIVE=30m                    # varsayılan
SKMCP_LLM_TIMEOUT_MS=300000                 # varsayılan; tek istek

npx sk-mcp-llm
```

Yalnızca model zorunlu. Ayrıştırma ölümcül, host'a ulaşmak değil: host kapalıyken de sunucu açılır ve `local_status` `reachable: false` döner. Açılışta model ısıtılır.

`SKMCP_LLM_NUM_CTX`'i GPU'nun gerçekten verdiği pencereye göre ayarlayın. Ollama büyük girdiyi reddetmez, başını sessizce atar; bütçe bu değerden türer.

## Bağlayıcı kurallar

- **`src` üç lint-zorunlu katman + üç kök giriş noktası.** `platform/` (mcp-core ve node sınırı), `backend/` (model host'u), `tools/` (MCP yüzeyi). `tools/` host'u yalnızca `backend/port.ts` üzerinden görür; somut backend `cli.ts`'te bağlanır.
- **Ağa yalnızca `src/backend/ollama.ts` çıkar**, yalnızca global `fetch` ile. `fetch` global'i ve `node:http`/`net`/`tls` ailesi başka her yerde lint ile yasak.
- **`process.env` yalnızca `cli.ts`'te okunur** ve her değişken adıyla erişilir.
- **Dosya yolları workspace'e çözülür.** İstenen yol ve onun `realpath`'i ayrı ayrı kontrol edilir; dışarıyı gösteren bir symlink de reddedilir. `readText` yalnızca bu iki kontrolden geçmiş `WorkspacePath` markalı yolu kabul eder. Hata zarflarında workspace'in mutlak yolu `.` olarak görünür.
- **Token'ı sunucu sayar.** Girdi `num_ctx × 0,45` bütçesini aşarsa host'a hiç gitmez; bütçeye hiçbir koşulda sığmayacak dosya okunmadan reddedilir. Cevap `num_ctx × 0,4` ile sınırlıdır.
- **Dosya sistemine yalnızca `src/platform/workspace.ts` dokunur** (lint ile). Tek yazıcı `createOutput`: çıktı klasörü `realpath`'iyle yeniden kontrol edilir; dosya adını sunucu seçer, güvenli alfabeye indirger ve uzantıyı `.csv` sabitler; `wx` ile açar, yani var olan dosyanın ya da symlink'in üzerine yazmaz; hiçbir şey silinmez ([mcp-core](../../cores/mcp-core/README.md#design-decisions)).
- **`local_map` satır numarasını modele ve geri taşır.** Id'siz format sırayı kaybediyordu. Atlanan satır bir kez yeniden sorulur, hâlâ yoksa etiketsiz bırakılır ve sayılır; tahmin edilmez.
- **Parçalanan girdi de kesilmez.** Parçalar paragraf, sonra satır sınırından bölünür; her parçadan not çıkar, notlar birleştirilip talimat son kez uygulanır. Notlar bütçeye sığmazsa birleştirme turu tekrarlanır (en çok 3); yine sığmazsa `input_too_large`.
- **Host başına tek istek.** `createSerialBackend` istekleri sıraya koyar: GPU paralel çalışmıyor, codex ise çağrıları aynı anda atıyor. `probe` kuyruğa girmez.
- **Yeni bir host türü `Backend` arayüzünün başka bir uygulamasıdır.** Sunucunun geri kalanı değişmez.

## Test

`pnpm turbo run test --filter=@sk-mcp/llm-mcp` — host gerekmez, `fetch` sahtelenir.

`test/live.spec.ts` gerçek bir Ollama'ya karşı koşar:

```text
SKMCP_LLM_LIVE=1 SKMCP_LLM_BASE_URL=http://127.0.0.1:11434 SKMCP_LLM_MODEL=qwen3:8b \
  pnpm turbo run test --filter=@sk-mcp/llm-mcp -- test/live.spec.ts
```

## Design notes and measurements

The rest of this README is Turkish; this section is English on purpose so the measurements behind the design stay legible without a translation pass. It covers only what the in-code guard comments do not already say.

### Why an MCP server instead of pointing codex at Ollama directly

Four ways of getting codex to a local model were tried; only the MCP server worked.

| Approach                 | Result                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex straight to Ollama | Ollama 0.34.2 serves `/v1/responses` and the connection succeeds, but the local model does not know codex's tool protocol — it called a `Read` tool that does not exist, and Ollama answered the next request with `no user query found`. The real blocker: codex starts every turn with a ~37k-token base cost, which does not fit a 16k context |
| Codex shell runs `curl`  | The sandbox cuts network access; opening it means giving codex network access everywhere, not just to the local model                                                                                                                                                                                                                             |
| Codex's `spawn_agent`    | Accepts OpenAI models only                                                                                                                                                                                                                                                                                                                        |
| **MCP server**           | Runs outside the sandbox and reaches Ollama itself. Only the prompt reaches the local model (measured: 196 tokens) — codex's ~37k-token turn overhead never leaves codex                                                                                                                                                                          |

The server's working directory is codex's workspace: every file argument the tools accept is resolved against it, and a path that resolves outside it is refused.

### Model choice

`gpt-oss:20b` was measured scoring 0/100 on the id-bearing JSON schema `local_map` and structured `local_task` calls depend on — the model could not hold the schema. A `qwen3` model (`qwen3:8b` in the examples above) is what the measurements in this repository were run with; `SKMCP_LLM_MODEL` has no built-in default; it must be set explicitly.

### Codex alone on tabular data

On a 400-row labelling task with clear cues, codex working alone was as accurate as delegating (14/14 correct) and about 3.5x faster: 48 s versus 166 s through `local_map`. This is why `DELEGATION_INSTRUCTIONS` (`products/chat/api/src/codex/delegation-instructions.ts`) allows codex to write a script instead of delegating when the data is tabular with clear patterns — delegating only pays off on long or unstructured text, not on rows a script can already parse.

### Rejected alternatives

- **The name `ollama-mcp`.** Too narrow once the backend became pluggable; `llm-mcp` follows the repo's convention of naming a server after the resource behind it, not the current backend.
- **A private `products/chat/worker`.** The server has nothing chat-specific in it — tools take a file path and an instruction, schemas are plain JSON Schema on the MCP surface. Keeping it inside `products/chat` would close it to outside contribution and force reinventing the payload budget that `@sk-mcp/mcp-core` already provides.
- **Using an existing open-source repo.** Most of the ones reviewed are Python, and one carries a license that forbids modification; none of them know codex's approval mode, its workspace boundary, or the payload budget. Ideas were borrowed where they held up: per-kind ready-made prompts (from `ollama-handoff`), file-path-taking tools and failover (from `LocalTokens`), and "the worker produces bounded output, the strong side accepts it" (from Shahriar/ollama-mcp-server).
- **One tool per job kind.** Every extra tool schema is token cost on every codex turn; one `local_task` tool with a `kind` enum covers the same ground for less.
- **Raising concurrency instead of queueing.** Four parallel requests to one GPU were only 1.1x faster than four sequential ones — the GPU does not run requests in parallel, so a queue is the only thing that keeps a call inside its own timeout.

### Out of scope (deliberately)

- **An agent loop on the local model.** A reviewed repo's small model, run through a full agent harness, took 5–7 minutes on a simple task and once reported having done work it had not done. Agent work already has codex's own `spawn_agent`.
- **Embedding.** `bge-m3` is available on the host but unused; add it if a search need appears.
- **Reading `.xlsx` directly.** v1 reads CSV and plain text only. An `.xlsx` input goes through `@sk-mcp/excel-mcp` from the calling side; teaching this server the format directly is out of scope for now.

### Measured runs

All codex runs below used `gpt-5.6-luna` at `low` reasoning effort, against Ollama 0.34.2 with `num_ctx` 16,384. "Cache-free" is `input_tokens − cached_input_tokens`.

| Run | Data                | Setup                          | Time  | Cache-free input | Output | Result                                                                                                      |
| --- | ------------------- | ------------------------------ | ----- | ---------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| S0  | 400 rows, with cues | codex alone                    | 53 s  | 31.1k            | 1.8k   | 14/14 days                                                                                                  |
| S1  | 400 rows, with cues | `local_task` only              | 68 s  | 32.5k            | 2.4k   | 14/14 (local call hit `input_too_large`, codex fell back to Python)                                         |
| S2  | 400 rows, with cues | `local_map`, auto-approved     | 155 s | 41.4k            | 1.5k   | 14/14, codex never read the rows                                                                            |
| H0  | 400 rows, no cues   | codex alone                    | 48 s  | 25.8k            | 1.9k   | 14/14 (read 200 rows and wrote a rule)                                                                      |
| H2  | 400 rows, no cues   | `local_map`, blind instruction | 162 s | 18.4k            | 1.7k   | **2/14** (376/400 rows labelled)                                                                            |
| H3  | 400 rows, no cues   | `local_map`, sample + verify   | 166 s | 24.5k            | 2.2k   | 14/14 (400/400 rows labelled)                                                                               |
| D0  | 17 documents        | codex alone                    | 65 s  | 34.1k            | 2.9k   | 17 records (read only the first 240 lines of each document)                                                 |
| D2  | 17 documents        | `local_task` + chunking        | 226 s | 25.7k            | 3.0k   | 17 records, codex read no document itself; 17 calls arrived at once, the queue cleared in 157 s, no timeout |
