# llm-mcp — codex'in yerel modellere iş devretmesi

**Durum:** F0, F1 ve F2 uygulandı — F3'ten itibaren öneri
**Tarih:** 23 Eylül 2026
**Kapsam:** `packages/servers/llm-mcp` (yeni), `packages/cores/mcp-core` (yazan tool türü), `products/chat/api` (`codex-client.ts` bağlantısı ve workspace'e yazılan `AGENTS.md`)
**Kaynak:** scratchpad'de prototip sunucu, Ollama ölçümleri, `gpt-5.6-luna` (`low`) ile 8 codex koşusu, 6 açık kaynak reponun incelenmesi

## 1. Sorun

- Yerel modeller GPU'da 16k context'e düşüyor. Bu pencerede plan tutulamıyor, uzun iş yaptırılamıyor.
- Codex'in penceresi büyük ama ücretli, ve yerel modellere ulaşamıyor.
- Hedef: planı codex yapsın, dar dil işlerini bedava yerel modele devretsin.

## 2. Neden MCP

Codex'i yerel modele götürmenin dört yolu denendi. Yalnızca MCP çalışıyor.

| Yol                                 | Sonuç                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex'i doğrudan Ollama'ya bağlamak | Ollama 0.34.2 `/v1/responses` servis ediyor, bağlantı kuruluyor. Ama yerel model codex'in tool protokolünü bilmiyor (`Read` diye var olmayan bir tool çağırdı), Ollama ikinci istekte `no user query found` hatası veriyor. Asıl engel şu: codex her tura ~37k token taban maliyetle başlıyor, 16k'ya sığmıyor |
| Codex shell'den `curl` atsın        | Sandbox network'ü kesiyor. Açmak codex'e her yere network vermek demek                                                                                                                                                                                                                                         |
| Codex'in `spawn_agent`'ı            | Yalnızca OpenAI modellerini kabul ediyor                                                                                                                                                                                                                                                                       |
| **MCP sunucusu**                    | Sunucu sandbox dışında koşuyor ve Ollama'ya ulaşıyor. Yerel modele yalnızca prompt gidiyor (ölçülen: 196 token), codex'in 37k'sı codex'te kalıyor                                                                                                                                                              |

## 3. Ölçümlerden çıkan kurallar

Tasarımdaki her kural bir ölçüme dayanıyor.

| #   | Ölçüm                                                                                                                                                                                                                                                          | Kural                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `approvalPolicy: "never"` iken codex MCP çağrısını reddetti: _"requires approval, but approval policy is never"_                                                                                                                                               | `mcp_servers.<ad>.default_tools_approval_mode = "auto"` ve her tool'da doğru annotation. `auto` yetti, toptan onay veren `approve` gerekmedi             |
| 2   | `CodexOptions.env` MCP sunucusuna geçmiyor. Sunucu yalnızca `HOME` ve `PATH` görüyor                                                                                                                                                                           | Ollama adresi ve model `mcp_servers.<ad>.env` ile verilir                                                                                                |
| 3   | Sunucunun çalışma dizini codex'in workspace'i                                                                                                                                                                                                                  | Dosya yolları workspace'e göreli. Workspace dışına çıkan yol reddedilir                                                                                  |
| 4   | 16k'ya 84.608 karakter gönderildi: Ollama hata vermedi, 8.194 token işledi, **baştaki satırları attı**                                                                                                                                                         | Token'ı sunucu sayar. Bütçe `num_ctx × 0,45` (~7,4k). Aşan girdi ya parçalanır ya reddedilir, asla sessizce gönderilmez                                  |
| 5   | 4 paralel istek, 4 sıralı istekten yalnızca 1,1 kat hızlı                                                                                                                                                                                                      | Host başına tek, sıralı kuyruk                                                                                                                           |
| 6   | Codex 17 çağrıyı aynı anda attı                                                                                                                                                                                                                                | Kuyruk şart. Codex tarafındaki tool timeout'u kuyrukta bekleme süresini de kapsamalı                                                                     |
| 7   | Soğuk yükleme 20 sn, sıcak çağrı 0,3 sn                                                                                                                                                                                                                        | Her istekte `keep_alive: "30m"`. Sunucu açılışta modeli ısıtır                                                                                           |
| 8   | JSON şeması + satır id'si ile 25, 50, 100 ve 200 satırlık batch'lerin hepsi %100 doğru. Id'siz kısa formatta model döngüye girdi: 12.600 token çöp, 0/100                                                                                                      | Ollama `format` şeması kullanılır, her satırın id'si çıktıda kalır                                                                                       |
| 9   | Hız çıktıya bağlı: satır başına ~270 ms (~16 token)                                                                                                                                                                                                            | 1.000 satır ~5 dakika sürer. Büyük işler kısa sürmez, bu codex'e `local_status` üzerinden söylenir                                                       |
| 10  | `gpt-oss:20b` JSON şemasını tutturamadı (0/100)                                                                                                                                                                                                                | Varsayılan model `qwen3.8`. Tek model sürekli yüklü kalır                                                                                                |
| 11  | `AGENTS.md` yokken codex yerel modele hiç gitmedi                                                                                                                                                                                                              | Workspace'e her koşuda `AGENTS.md` yazılır                                                                                                               |
| 12  | Codex veriye bakmadan talimat yazdığında: satırların %94'ü doğru, günlerin yalnızca 2/14'ü doğru, ve codex fark etmedi                                                                                                                                         | Codex önce ~20 satırlık örnek okur. `local_map` her etiketten örnek satır döner, codex sonucu kullanmadan önce bunları kontrol eder                      |
| 13  | Tablo verisinde codex tek başına: 14/14, 48 sn, 25,8k cache'siz token. Yerel modelle: 14/14, 166 sn, 24,5k                                                                                                                                                     | Tablo işinde yerel model maliyeti düşürmüyor, süreyi uzatıyor. Kazancı gizlilik (codex 200+ yerine 20 satır görüyor) ve script'in çözemediği veri        |
| 14  | Uzun metin (17 döküman). Codex tek başına: 65 sn, 34,1k cache'siz token, her dökümanın yalnız ilk 240 satırını okudu. Yerel modelle: 226 sn, 25,7k cache'siz token, dökümanların hiçbiri codex'e gitmedi, yerel model dökümanların tamamını parçalayarak okudu | Yerel modelin gerçek kazancı uzun metinde: codex maliyeti %25 düşük, kapsam tam, metin dışarı çıkmıyor. Bedeli 3,5 kat süre. Fark metin büyüdükçe açılır |

## 4. Tasarım

### Nerede yaşar

`packages/servers/llm-mcp`, yayınlanabilir biçimde. Yayınlamak ayrı bir karar; ama paket baştan katkıya açık olur.

- Sunucuda chat'e özel hiçbir şey yok: tool'lar dosya yolu ve talimat alıyor, şemalar MCP yüzeyinde düz JSON Schema.
- Chat'e özel kısım (`AGENTS.md`, `codex-client.ts` bağlantısı) `products/chat/api`'de kalıyor.
- Chat sunucuyu excel-mcp ve xml-mcp'de olduğu gibi import etmeden subprocess olarak başlatıyor. Boundary kuralı ihlal edilmiyor.
- Payload bütçesi, `guard` ve hata zarfı `mcp-core`'dan geliyor.

**Önkoşul:** `mcp-core` bugün yalnızca salt-okunur tool kabul ediyor (`ToolDefinitions = Record<string, ReadOnlyToolDefinition>`, `readOnlyHint: true` zorunlu). `local_map` ise sonucu dosyaya yazıyor. Bu yüzden ilk faz, `mcp-core`'a "yalnızca sunucunun kendi çıktı klasörüne yeni dosya yazan" tool türünü ekleyen ayrı bir karar kaydı.

**Çıktı klasörü:** sunucu yalnızca workspace içindeki `.llm-mcp/out/` klasörüne yazar. Dosya adını kendisi seçer ve yolunu döner. Sunucunun içinden geçen hiçbir şey (yerel modelin çıktısı, yüklenen dosyanın içeriği) workspace'in başka bir yerine iz bırakamaz. Örneğin alt klasöre yeni bir `AGENTS.md` yazılıp codex'e talimat verilmesinin yolu kapanır.

### Tool'lar (v1)

| Tool                                                        | Ne yapar                                                                                                                                                                                                              | Annotation                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `local_task(kind, instruction, text?, files?, jsonSchema?)` | Tek bir dil işi. `kind`: `classify`, `extract`, `summarize`, `transform`, `free`. Her kind'ın içinde kısa ve katı bir system prompt var. Dosyaları sunucu okur. Bütçeyi aşan `summarize`/`extract` girdisini parçalar | `readOnlyHint: true`                            |
| `local_map(file, instruction, labels)`                      | CSV'nin her satırını etiketler. Sonucu yeni bir sütunla `.llm-mcp/out/` altına yazar. Codex'e dosyanın yolunu, sayımları ve etiket başına 4 örnek satır döner                                                         | `readOnlyHint: false`, `destructiveHint: false` |
| `local_status()`                                            | Model yüklü mü, bütçe, kuyruk derinliği, hız                                                                                                                                                                          | `readOnlyHint: true`                            |

Tek bir `local_task` ve bir `kind` enum'u, her iş için ayrı tool açmaktan iyi: codex'e tek şema gidiyor, hazır prompt'lar yine de işe özel kalıyor.

### Sunucunun içi

1. **Token sayımı.** Türkçe metinde ~1,8 karakter/token. Ollama'nın döndürdüğü `prompt_eval_count` ile doğrulanır.
2. **Kuyruk.** Host başına tek istek. Bekleyen istek sayısı `local_status`'ta görünür.
3. **Ollama isteği.** `think: false`, `temperature: 0`, `num_ctx` sabit, `keep_alive: "30m"`, gerekiyorsa `format` şeması.
4. **Satır batch'i.** Girdi bütçesine ve çıktı tahminine (satır başı ~17 token) göre doldurulur. Eksik dönen satırlar bir kez yeniden denenir.
5. **Parçalama.** Paragraf sınırından böl, her parçadan not çıkar, notları birleştirip talimatı son kez uygula.
6. **Dosya sınırı.** Her yol workspace'e çözülür, dışarı çıkan yol reddedilir.
7. **Yanıt.** Büyük sonuç `.llm-mcp/out/` altına yazılır. Codex'e dosyanın yolu, özet, sayımlar ve kontrol için örnek döner.

### Genişleme noktaları

Sunucu tek bir kuruluma göre değil, herkesin kullanabileceği şekilde yazılır. Bunun için kararlar üç gruba ayrılır. Yaklaşım repoda zaten var: `db-core` hiçbir sürücünün adını bilmez (motor `Dialect` olarak dışarıdan gelir), `pdf-mcp`'de OCR "desteklenir ama uygulanmaz" (`OcrProvider` dışarıdan takılır).

**Sabit — ayar değil, çünkü tersi herkeste bozulur (bölüm 3'teki ölçümler):**

- Token'ı sunucu sayar, sessizce kesme yok.
- Host başına kuyruk.
- Id'li çıktı şeması.
- `keep_alive` ve açılışta ısıtma.
- `local_map` etiket başına örnek döner.
- Annotation'lar tool'un gerçekte yaptığını söyler.

**Ayar — dağıtıma göre değişir, varsayılanı güvenli. Yalnızca `cli.ts`'te okunur:**

- `SKMCP_LLM_OUTPUT_DIR` — varsayılan `.llm-mcp/out`. `.` verilirse workspace'in her yerine yazılır, üzerine yazma yine yasak.
- `SKMCP_LLM_NUM_CTX` — varsayılan `16384`. Bütçe ve batch boyutu buradan türetilir.
- `SKMCP_LLM_BASE_URL` — virgülle ayrılmış host listesi olabilir (F6).
- `SKMCP_LLM_MODEL` — varsayılan model. Kind başına model eşlemesi opsiyonel.
- `SKMCP_LLM_TOOLS` — açık tool'lar, varsayılan üçü.
- `SKMCP_LLM_PROMPTS` — kind prompt'larını değiştiren dosya, opsiyonel.

**Arayüz — v1'de tek uygulama, sonrası PR ile:**

- `Backend`: bir mesaj listesini ve opsiyonel bir JSON şemasını alır; metni ve token sayılarını döner. v1'de yalnızca Ollama uygulaması var, çünkü `num_ctx`, `keep_alive` ve `format`'ı Ollama'nın kendi API'si veriyor ve ölçümler onunla yapıldı. vLLM, llama.cpp ve LM Studio için OpenAI uyumlu bir uygulama sunucunun geri kalanına dokunmadan eklenir.
- İstemci: sunucu MCP konuştuğu için Codex'e bağlı değil. Claude Code ve Cursor da kullanabilir. Değişen yalnızca talimat dosyası (`AGENTS.md`, `CLAUDE.md`); şablonları README'de durur.

### Codex tarafı

`codex-client.ts`:

```ts
config: {
  sandbox_workspace_write: { network_access: false },
  mcp_servers: {
    local: {
      command: process.execPath,
      args: [workerEntry],
      default_tools_approval_mode: "auto",
      tool_timeout_sec: 900,
      env: { SKMCP_LLM_BASE_URL: llmBaseUrl, SKMCP_LLM_MODEL: llmModel },
    },
  },
},
```

### Politika dağıtıma ait

Sunucu politika bilmez; ne verilirse onu yapar. Neyin yerel modele gideceğine chat'i kuran taraf karar verir, ve bu karar `AGENTS.md` şablonunda durur. Şablon dağıtım ayarıyla değiştirilebilir.

- **Varsayılan (hız):** tablo verisinde codex script yazabilir. Yerel model uzun metin ve dil yargısı için kullanılır. Testlerde tablo işinde script aynı doğrulukta ve 3,5 kat hızlıydı (kural 13).
- **Verisi hassas olan kurulum:** şablonu "yerel model zorunlu" olarak değiştirir. Daha güçlü bir istek varsa planlayıcının kendisini kendi sunucusundaki bir modele taşır (codex `model_providers`). llm-mcp bu durumda da değişmeden çalışır.

`CodexWorkspaceService.prepare` her workspace'e varsayılan olarak şu `AGENTS.md`'yi yazar:

```md
# Delegation

You plan and verify. A free local model is available through the `local` MCP server; delegate language judgement to it.

- Tabular data with clear patterns: you may write a script instead of delegating.
- Row-wise judgement that needs language understanding: first read a small sample (about 20 rows), then call `local_map` with the file path and a precise instruction that names the cues you saw. It writes the labelled file itself and returns its path.
- `local_map` returns sample rows per label. Check them against your intent before using the output; if they are wrong, sharpen the instruction and run it again.
- One bounded language task: call `local_task`. Pass file paths in `files`; never paste file contents.
- Long documents: call `local_task` with `kind` summarize or extract and the file path, one call per document; it splits large inputs itself.
- Keep for yourself: planning, arithmetic, aggregation, writing output files, the final answer.
- If a local call fails, retry once, then do the work yourself.
```

## 5. Fazlar

Her faz bir öncekinin üstüne kurulur ve kendi çıkış kriteriyle kapanır.

### F0 — `mcp-core`'a yazan tool türü

- `docs/` altında karar kaydı ([cikti-yazan-tool-karari.md](cikti-yazan-tool-karari.md)): "yalnızca kendi çıktı klasörüne yeni dosya yazan" tool türü, annotation'ı (`readOnlyHint: false`, `destructiveHint: false`), ve mevcut salt-okunur sunucuların bundan etkilenmemesi.
- `mcp-core`'da bu türün tipi. `guard` ve payload bütçesi ona da uygulanır.
- CLAUDE.md'deki `mcp-core` satırı güncellenir.

**Çıkış:** excel/xml/pdf/mssql'de tek satır değişmedi, testleri geçiyor. Yeni tür tip seviyesinde yalnızca açıkça seçen sunucuya açık.

### F1 — Paket iskeleti ve bağlantı

- `packages/servers/llm-mcp`: excel-mcp'nin yayınlanabilir biçimi (`bin`, `files`, `publishConfig`, `exports.types → dist`), `pack` job'una ekleme, CLAUDE.md tablosuna satır.
- `process.env` yalnızca `cli.ts`'te, her değişken adıyla okunur.
- `Backend` arayüzü ve Ollama uygulaması. Ayarlar `cli.ts`'te okunur.
- stdio sunucu, `local_status`, açılışta ısıtma.
- `codex-client.ts`'e `mcp_servers` bloğu. `CodexWorkspaceService.prepare` `AGENTS.md` yazar.
- `.codex-home` temiz tutulur: ilk ölçümde bir plugin'in skill'i her tura eklenip taban maliyeti şişiriyordu.

**Çıkış:** chat'ten açılan bir codex turu `local_status`'u çağırıyor ve cevabı görüyor.

**Durum:** uygulandı. `gpt-5.6-luna` (`low`) ile tek tur: codex `local.local_status`'u çağırdı (`completed`), modeli ve 7.372 token'lık bütçeyi cevabında kullandı. 12,6 sn, 12,0k cache'siz input. Env adları repo kalıbına uyarak `SKMCP_LLM_*` oldu. Sunucu yolu chat'e `CHAT_CODEX_LLM_MCP_ENTRY` ile veriliyor. `AGENTS.md` F1'de yalnızca `local_status`'u anıyor, çünkü var olmayan bir tool'u anmak codex'i onu aramaya yollar.

### F2 — `local_task`

- `kind` başına hazır prompt'lar, `jsonSchema` desteği, `files` okuma, workspace sınırı.
- Bütçe koruması: aşan girdi `input_too_large` döner.

**Çıkış:** kısa bir metinde `extract` doğru JSON dönüyor. Workspace dışı yol reddediliyor. Büyük dosya kesilmeden reddediliyor.

**Durum:** uygulandı. stdio'da gerçek host'a karşı: Türkçe bir metinden `extract` + şema `{"people":["Ayşe Demir","Mehmet Kaya"],"nextMeeting":"2026-10-14"}` döndü (101 prompt token). `../../../../etc/passwd` → `outside_workspace`. 63 KB dosya okunmadan `input_too_large` (tavan 53.078 bayt = bütçe × 1,8 × 4). Argüman adı repo kalıbına uyarak `jsonSchema` oldu. Kök `SKMCP_LLM_ROOT`, varsayılanı çalışma dizini. Symlink ile dışarı kaçış da reddediliyor.

Codex turu (`gpt-5.6-luna`, `low`): codex bir toplantı notundan katılımcıları ve tarihleri `local.local_task` ile çıkardı ve dosyayı kendisi hiç okumadı. İlk koşuda `.codex-home`'da kurulu `superpowers` plugin'i codex'e 240 satırlık bir skill dosyası okuttu (46,9k input, 13,1k cache'siz). `codexConfigFor` artık `features.plugins=false` ve `features.apps=false` gönderiyor. Aynı tur sonra 28,5k input ve 10,6k cache'siz token harcadı, shell komutu çalışmadı. F1'deki "`.codex-home` temiz tutulur" maddesi böylece dağıtıma değil koda bağlandı.

### F3 — `local_map`

- Id'li şema, bütçeye göre batch, eksik satırlarda tek yeniden deneme, `.llm-mcp/out/` altına yazma ve yolu dönme, etiket başına örnek.

**Çıkış:** 400 satırlık zor sette etiketler 400/400. Codex `AGENTS.md` ile günlük raporu 14/14 doğru çıkarıyor.

### F4 — Uzun girdi

- `summarize` ve `extract` için parçalama (map-reduce).

**Çıkış:** 54k karakterlik bir döküman kesilmeden özetleniyor ve özet dökümanın sonundaki kararları da içeriyor.

### F5 — Chat entegrasyonu

- Codex turun kendisi olur, `codex_task` tool'u kalkar.
- Bugünkü yerel orkestratör (`llm.service.ts`) yalnızca kapıya iner: "sohbet mi, iş mi?"
- `mcp_tool_call` olayları UI'daki ilerleme akışına eklenir.

**Çıkış:** "bu excel'den günlük/haftalık rapor çıkar" isteği uçtan uca çalışıyor, UI'da yerel çağrılar görünüyor.

### F6 — Ölçeklenme

- Çoklu Ollama host'u: round-robin ve failover (LocalTokens'taki modelin eşzamanlılık sınırlı hali).
- Tasarruf kaydı: işçi süresi + doğrulama + codex'in tamiri birlikte ölçülür.
- 1.000 satırı aşan işler için iş modeli (başlat → durum sor).

**Çıkış:** ikinci bir GPU eklenince kuyruk iki host'a dağılıyor. Bir host kapanınca işler diğerine geçiyor.

## 6. Bilinçli kapsam dışı

- **Yerel modele ajan loop'u.** İncelenen reponun ölçümüne göre küçük modelle tam ajan harness'ı basit işte 5-7 dakika sürdü ve bir kere yapmadığı işi yaptım dedi. Ajan işi için codex'in `spawn_agent`'ı var.
- **Embedding.** Hostta `bge-m3` duruyor. Arama ihtiyacı çıkınca eklenir.
- **xlsx'i doğrudan okumak.** v1 CSV ve düz metin okur. xlsx için işçi excel-mcp'yi çağırır, bu F6 sonrası.

## 7. Reddedilen alternatifler

- **Codex'i doğrudan Ollama'da koşturmak:** 37k taban 16k'ya sığmıyor (bölüm 2).
- **`ollama-mcp` adı:** backend takılabilir olunca dar kalır. Repodaki diğer sunucular gibi arkasındaki kaynağın adını taşıyan `llm-mcp` seçildi.
- **`products/chat/worker` (private):** sunucu generic, chat'e özel bir şey içermiyor. Chat içinde katkıya kapalı kalır ve payload bütçesini kendisi yeniden yazmak zorunda kalır.
- **Hazır bir repoyu kullanmak:** incelenenlerin çoğu Python, biri değiştirmeyi yasaklayan lisansta. Hiçbiri codex'in onay modunu, workspace sınırını ya da payload bütçesini bilmiyor. Fikirleri alındı: kind başına hazır prompt (ollama-handoff), dosya yolu alan tool'lar ve failover (LocalTokens), "işçi sınırlı çıktı üretir, güçlü taraf kabul eder" ilkesi (Shahriar/ollama-mcp-server).
- **Her iş için ayrı tool:** her şema codex'in her turuna token olarak ekleniyor. Tek tool + `kind` aynı işi daha ucuza görüyor.
- **Id'siz kısa çıktı formatı:** model sırayı kaybediyor (kural 8).
- **Eşzamanlılığı artırmak:** GPU paralel çalışmıyor (kural 5).

## 8. Verilen kararlar

1. **Konum ve ad:** `packages/servers/llm-mcp`, paket adı `@sk-mcp/llm-mcp`, yayınlanabilir biçimde. Ürün olarak yayınlanmasa bile katkıya açık kalır.
2. **Yazma sınırı:** varsayılan olarak sunucu yalnızca `.llm-mcp/out/` altına yazar ve yolu kendisi döner. `SKMCP_LLM_OUTPUT_DIR` ile genişletilebilir.
3. **Tablo politikası:** sunucuda değil, dağıtımda. Varsayılan hız: codex tablo verisinde script yazabilir. Verisi hassas olan kurulum şablonu değiştirir ya da planlayıcıyı kendi modeline taşır.

## Ek — Deney kayıtları

Tüm codex koşuları `gpt-5.6-luna`, `low` reasoning. "Cache'siz" = `input_tokens − cached_input_tokens`.

| Koşu | Veri               | Düzen                        | Süre   | Cache'siz input | Output | Sonuç                                                                                                |
| ---- | ------------------ | ---------------------------- | ------ | --------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| S0   | 400 satır, ipuçlu  | codex tek başına             | 53 sn  | 31,1k           | 1,8k   | 14/14 gün                                                                                            |
| S1   | 400 satır, ipuçlu  | yalnız `local_task`          | 68 sn  | 32,5k           | 2,4k   | 14/14 (yerel çağrı `input_too_large`, codex Python'a döndü)                                          |
| S2   | 400 satır, ipuçlu  | `local_map`, `auto` onay     | 155 sn | 41,4k           | 1,5k   | 14/14, codex satırları hiç okumadı                                                                   |
| H0   | 400 satır, ipuçsuz | codex tek başına             | 48 sn  | 25,8k           | 1,9k   | 14/14 (200 satır okuyup kural yazdı)                                                                 |
| H2   | 400 satır, ipuçsuz | `local_map`, kör talimat     | 162 sn | 18,4k           | 1,7k   | **2/14** (etiketler 376/400)                                                                         |
| H3   | 400 satır, ipuçsuz | `local_map`, örnek + kontrol | 166 sn | 24,5k           | 2,2k   | 14/14 (etiketler 400/400)                                                                            |
| D0   | 17 döküman         | codex tek başına             | 65 sn  | 34,1k           | 2,9k   | 17 kayıt (her dökümanın yalnız ilk 240 satırını okudu)                                               |
| D2   | 17 döküman         | `local_task` + parçalama     | 226 sn | 25,7k           | 3,0k   | 17 kayıt, codex hiç döküman okumadı. 17 çağrı aynı anda geldi, kuyrukta 157 sn'de bitti, timeout yok |
