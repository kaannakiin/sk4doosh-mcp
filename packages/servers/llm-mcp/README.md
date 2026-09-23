# @sk-mcp/llm-mcp

Planlayan bir ajanın (Codex, Claude Code, Cursor) sınırlı dil işlerini yerel bir modele devretmesini sağlayan MCP sunucusu. `@sk-mcp/mcp-core` üzerine kuruludur ve ondan başka hiçbir `@sk-mcp/*` paketi adlandırmaz. Tasarım ve ölçümler: [llm-mcp-plani.md](../../../docs/llm-mcp-plani.md).

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
- **Dosya sistemine yalnızca `src/platform/workspace.ts` dokunur** (lint ile). Tek yazıcı `createOutput`: çıktı klasörü `realpath`'iyle yeniden kontrol edilir; dosya adını sunucu seçer, güvenli alfabeye indirger ve uzantıyı `.csv` sabitler; `wx` ile açar, yani var olan dosyanın ya da symlink'in üzerine yazmaz; hiçbir şey silinmez ([cikti-yazan-tool-karari.md](../../../docs/cikti-yazan-tool-karari.md)).
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
