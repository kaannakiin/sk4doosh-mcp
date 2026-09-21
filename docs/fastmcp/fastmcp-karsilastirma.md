# sk-mcp ↔ FastMCP OpenAPI Karşılaştırması

**Durum:** Tasarım notu. §4.1–§4.7 ve §4.9'un `deepObject` yarısı sevk edildi (§7–§14); açık kalan tek madde §4.8 form/multipart body. Karar kayıtları: [arguman-kuratorlugu-karari.md](arguman-kuratorlugu-karari.md), [outputschema-karari.md](outputschema-karari.md), [invoke-korumalari-karari.md](invoke-korumalari-karari.md), [search-detail-karari.md](search-detail-karari.md), [selection-rule-karari.md](selection-rule-karari.md), [deepobject-karari.md](deepobject-karari.md)
**Tarih:** 17 Eylül 2026
**Odak:** FastMCP'nin OpenAPI/FastAPI entegrasyonu ile sk-mcp HTTP kataloğunun yan yana okunması; alınabilecekler, alınmayacaklar
**Kapsam:** `packages/spec`, `packages/core`, `sdks/*` — HTTP katalog ürün hattı. `file-core` ve `products/chat` bu notun dışında
**Kaynaklar:** FastMCP `main` (2026-09-17 klonu): `docs/integrations/{openapi,fastapi}.mdx`, `docs/servers/{visibility,authorization,middleware,tool-fingerprinting,versioning,pagination}.mdx`, `docs/servers/transforms/{tool-search,code-mode,tool-transformation}.mdx`, kaynak `fastmcp/server/providers/openapi/*`, `fastmcp/utilities/openapi/*`, `fastmcp/server/transforms/search/*`; J. Lowin, _Stop Converting Your REST APIs to MCP_ (Temmuz 2025)

---

## 1. Tek cümlelik özet

FastMCP OpenAPI bir **dış adaptör**dür: OpenAPI dokümanını okur, backend'i ağ üzerinden `httpx` ile çağırır, backend'in yetkilendirmesi hakkında hiçbir şey bilmez. sk-mcp bir **gömülü katman**dır: framework metadata'sını okur, çağrıyı backend'in kendi pipeline'ından sentetik istekle geçirir, çağıranın kimliğini taşır ve backend'in kendi yetki kararını görünürlüğe çevirir.

FastMCP'nin yazarı bu adaptörü kendi ağzıyla prototip aracı olarak konumluyor ("Bootstrap, don't deploy"). Biz aynı cümlenin ürünleştirilmiş hâlini yapıyoruz. Bu, Lowin'in eleştirisinin bizi de bağladığı anlamına gelir: context şişmesi, atomik çağrı zincirleri, benzer isimli tool'lar arasında kararsızlık. Bizim cevabımız search-first katalog, üç değerli görünürlük ve isim disiplini. Bu cevap doğru ama eksik: onun önerdiği **küratörlük katmanı** (`Tool.from_tool`, `ArgTransform`) bizde yok. En büyük boşluk budur (§4.4).

---

## 2. FastMCP'nin yaptığı şeyin özeti

Karşılaştırmaya girmeden önce onların modelini kendi terimleriyle:

- **Kaynak:** OpenAPI 3.0/3.1 JSON. `parse_openapi_to_http_routes` her operation'ı `HTTPRoute` IR'ına indirger (`path, method, operation_id, parameters, request_body, responses, request_schemas, response_schemas, flat_param_schema, parameter_map`). FastAPI için `app.openapi()` çıktısı aynı yoldan geçer.
- **Seçim:** sıralı `RouteMap` listesi (method + path regex + tag → `TOOL | RESOURCE | RESOURCE_TEMPLATE | EXCLUDE`); ilk eşleşen kazanır; default her şey TOOL. `route_map_fn` callback'i sonucu ezer. 2.8.0'dan önce GET'ler Resource'a gidiyordu; **istemci uyumluluğu** için hepsi TOOL yapıldı.
- **İsim:** `operationId`'nin ilk `__`'ye kadar olan kısmı → slugify → **56 karakterde sessiz kesme** → çakışırsa **sessiz `_2`, `_3`**. `mcp_names` sözlüğüyle elle eşleme.
- **Şema:** parametreler + body alanları tek düz `inputSchema`. `allOf` birleştirilir; `discriminator` alt tiplerinin tüm alanları opsiyonel olarak düzleştirilir ve `discriminator` anahtarı atılır. Body alanı bir parametreyle çakışırsa **parametre** `name__location` (`id__path`, `values__query`) olarak yeniden adlandırılır. Property'siz body tek argüman olur: adı şemanın `title`'ı, yoksa `body`. `$ref`'ler `#/$defs/` altına toplanır ve kullanılmayanlar budanır. OpenAPI 3.0 `nullable` → `type: [x, "null"]`. Parametre `default`'u şemaya kopyalanır.
- **Çağrı:** `RequestDirector.build` düz argümanları `parameter_map` ile konumlarına dağıtır. **Bilinmeyen argüman log warning ile sessizce düşer.** Query array style/explode OpenAPI default'larıyla; path array virgülle; `deepObject` destekli; cookie parametreleri destekli. Body: JSON, `+json`, `text/plain`, `x-www-form-urlencoded`, `multipart/form-data` (dosya parçaları dahil). MCP isteğinin HTTP header'ları, backend isteğinde zaten yoksa **hepsi** iletilir (`get_http_headers()`).
- **Hata:** `_raise_for_status` 2xx dışını `ValueError("HTTP error {status}: {reason} - {tam body}")` yapar; MCP `isError` sonucu olur. Sızıntı filtresi yok; 401 body dahil her şey ajana akar. Log'larda header redaksiyonu var (`_SAFE_HEADERS` dışı `***`).
- **Output:** birincil 2xx response şeması `outputSchema` olur; object değilse `{ "result": … }` ile sarılır (`x-fastmcp-wrap-result`); yanıt `structured_content` olarak döner; `validate_output=False` ile izin verici şema.
- **Discovery:** `RegexSearchTransform` / `BM25SearchTransform`: `tools/list` iki sentetik tool döner (`search_tools`, `call_tool`); arama **tam tanımı** döner (tek tur). İndeks name + description + **parametre adları + parametre açıklamaları**. BM25 k1=1.5, NFKC casefold, prefix yok, alan ağırlığı yok, lazy build + hash ile staleness. `always_visible` ile pin. **CodeMode** (deneysel): `search / get_schema / execute`, detay seviyeleri `brief | detailed | full`, "2 of 10 tools" notu, `GetTags` ile kategori gezme, Monty sandbox'ta Python ile tool zinciri, `max_tool_calls=50`.
- **Görünürlük:** `enable()/disable()` isim/tag/versiyon/key ile; allowlist modu; provider ve server katmanları; **session bazlı** `ctx.enable_components()` (progressive disclosure); değişiklikte otomatik `list_changed`.
- **Yetkilendirme:** component `auth=require_scopes(...)` hem listeden gizler hem çağrıyı reddeder; `AuthMiddleware` sunucu geneli; `InsufficientScopeError` eksik scope'ları ajana söyler; tam OAuth server / OAuth proxy / OIDC proxy / token verifier sağlar.
- **Middleware:** logging, timing, caching, rate limiting, error handling, **response size limit** (500 KB'de kes), custom hook'lar.
- **Diğer:** `ToolTransform`/`ArgTransform` (rename, hide + default/default_factory, description, type, required), versiyonlama (`VersionFilter`, `_meta.fastmcp.version`), `tools/list` sayfalama, tool fingerprint reçetesi, MCP background tasks, elicitation, sampling.

---

## 3. Nokta nokta karşılaştırma

| Konu                              | FastMCP                                                                                                                                             | sk-mcp                                                                                                                                                                                                                                      | Değerlendirme                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **İsim çakışması**                | Sessiz `_2`; 56 karakterde sessiz kesme; `operationId` `__`'ye kadar                                                                                | `name_collision` fatal; 256 sınır + `long_tool_name` uyarısı; container prefix + tekrar bastırma; çoklu route → tek tool + `alternateRoutes` ([naming.md](../../packages/spec/naming.md))                                                   | **Biz.** Sessiz `_2`, komşu endpoint eklendiğinde mevcut tool'un adını kaydırır; ajanın öğrendiği isim kararsızlaşır                                        |
| **Bilinmeyen argüman**            | Log warning, argüman sessizce düşer                                                                                                                 | `unknown_argument` + izinli isim listesi ([argument-mapping.md](../../packages/spec/argument-mapping.md) adım 1)                                                                                                                            | **Biz**                                                                                                                                                     |
| **Parametre/body isim çakışması** | Parametre `id__path` olur, description'a "(Path parameter)" eklenir, body düz kalır                                                                 | Body `body` kök argümanına iner, `body_field_collision` uyarısı ([schema-conversion-rules.md](../../packages/spec/schema-conversion-rules.md) Tablo 6)                                                                                      | **Berabere, tartışılır** (§5)                                                                                                                               |
| **Body düzleştirme**              | Kök anahtarlar denetlenmez (`minProperties`, `propertyNames` kaybolur); `allOf` birleştirilir; `discriminator` alt tipleri hepsi opsiyonel düzleşir | Altı anahtarlık whitelist; dışında bir anahtar varsa kök argüman; `$id`/`$anchor` asla düzleşmez; optional body asla düzleşmez                                                                                                              | **Biz.** Onlarınki bilinçli "local strictness" fedası. Bizde TypeShape'ten `allOf` doğmaz; sadece `verbatim` host şemasıyla gelebilir                       |
| **`default`**                     | Şemaya kopyalanır                                                                                                                                   | Yazılmaz; PATCH'te "yok" ile "açıkça default" farklı istekler                                                                                                                                                                               | **Biz**, gerekçeli                                                                                                                                          |
| **Nullable**                      | 3.0 `nullable` → tip dizisi                                                                                                                         | Pinlenmemiş alan; IR'da nullable düğüm yok                                                                                                                                                                                                  | Parite gerekmez; bizim gerekçe spec'te                                                                                                                      |
| **Array serileştirme**            | style/explode OpenAPI default'ları; path array virgül; `deepObject`; cookie                                                                         | Aynı default'lar; delimiter encoder'dan geçmez (iki dilin encoder farkı); boş array anahtar yazmaz; path array yasak; `spaceDelimited+explode:true` reddedilir                                                                              | Parite. `deepObject` ve cookie bizde yok (§4.9)                                                                                                             |
| **Path encoding**                 | `httpx`'e bırakılır                                                                                                                                 | Katı RFC 3986, `!'()*` dahil; ham birleştirme yasak (`5/../admin` tek segment)                                                                                                                                                              | **Biz**; fixture-pinned                                                                                                                                     |
| **Body tipleri**                  | JSON, `+json`, `text/plain`, form-urlencoded, multipart (dosya)                                                                                     | Sadece JSON; form/file → `unsupported_binding`, endpoint düşer                                                                                                                                                                              | **FastMCP daha geniş** (§4.8)                                                                                                                               |
| **Hata haritalama**               | Tam body, 401 dahil, ajana akar; sızıntı filtresi yok                                                                                               | Dokuz kodlu sözlük, `retryable`, `fields`, `reference`; 401 body asla, 5xx body asla, HTML asla; pattern deny-list; host recognizer ([error-mapping.md](../../packages/spec/error-mapping.md))                                              | **Biz, açık ara**                                                                                                                                           |
| **Output schema**                 | 2xx şeması `outputSchema`; `{result}` sarma; `structured_content`; `validate_output`                                                                | `load_tool` `outputSchema` döner; birincil response sırası 200/201/202/204, object olmayan kök `{result}` ile sarılır, `$defs` sarmalayıcı köke kalkar, readOnly korunur ([metadata-contract.md](../../packages/spec/metadata-contract.md)) | **Berabere** (§8). `structuredContent` doğrulaması bilinçli kapsam dışı: `invoke_tool` sabit meta-tool, şeması çağrı başına değişir                         |
| **Discovery turu**                | `search_tools` tam tanım döner → 2 tur. CodeMode detay seviyeleri                                                                                   | kart → `load_tool` → `invoke_tool`: 3 tur; kart 160 karakter + `parameters` özeti                                                                                                                                                           | Onların docs'u büyük kataloglarda staged discovery'yi savunur = bizim default. `detail: "schema"` ile merdiven ajanın seçimiyle 2 tura iner (§11)           |
| **Search algoritması**            | BM25 k1=1.5; NFKC casefold; prefix yok; alan ağırlığı yok; **parametre adları/açıklamaları indekste**                                               | BM25 k1=1.2; alan ağırlıkları; prefix eşleşme; NFD folding; sondaki `s`; fixture-pinned ([search-semantics.md](../../packages/spec/search-semantics.md))                                                                                    | Bizimki Türkçe için özellikle daha iyi. Parametre adları ve açıklamaları artık bizde de indekste (§10), ama küratörlenmiş yüzeyden ve yalnız kök derinlikte |
| **Görünürlük**                    | enable/disable; session bazlı; allowlist; component `auth` hem gizler hem reddeder                                                                  | Üç değerli karar; T0–T2 ladder; probe; `authUncertain`; caller-scope cache; invariant 1: invoke asla visibility'ye bakmaz ([visibility.md](../../packages/spec/visibility.md))                                                              | **Biz.** Onlarınki MCP token'ına bağlı, backend yetkisinden habersiz. Bizde karşılığı olmayan tek şey session-scoped progressive disclosure (§5)            |
| **Seçim**                         | Sıralı `RouteMap` (regex/tag), default her şey TOOL, ilk eşleşen kazanır                                                                            | Dört seviye most-specific-wins; global default `exclude`; config kuralları sırasız, çelişki `ambiguous_selection` fatal ([selection-hierarchy.md](../../packages/spec/selection-hierarchy.md))                                              | **Biz.** Bizimki default-deny, ve config kuralı §13'te geldi — ama sıralı liste olarak değil: "ilk eşleşen kazanır" sessiz çözümdür (§4.6, §13)             |
| **Transport / auth**              | OAuth server, OAuth/OIDC proxy, token verifier, `AuthMiddleware`, `InsufficientScopeError`                                                          | PRM + 401 decoration + audience kuralı; enforcement host'a bırakılır ([transport.md](../../packages/spec/transport.md))                                                                                                                     | Farklı roller: onlar auth **sağlar**, biz host'un auth'unu **kullanırız**. Tutarlı                                                                          |
| **Middleware**                    | Rate limit, timing, caching, **response size limit**, custom hook                                                                                   | Yok. `invoke_tool`'da **payload bütçesi yok, timeout yok** (iki SDK'da da grep boş). `file-core`'da `maxPayloadBytes` var, HTTP katalogda yok                                                                                               | **FastMCP** (§4.2)                                                                                                                                          |
| **Argüman küratörlüğü**           | `ArgTransform`: rename, hide + default/default_factory, description, type, required; `transform_fn`                                                 | `arguments` beyanı: `as`, `description`, `hidden` (`constant`/`deferred`/`omit`); `variants` ile tek endpoint'ten N tool ([argument-curation.md](../../packages/spec/argument-curation.md))                                                 | **Berabere**, kapsam farkı bilinçli: tip/zorunluluk değiştirme bizde kapsam dışı, çağırandan doldurma onlarda birinci sınıf değil (§4.4, §7)                |
| **Kimlik iletimi**                | MCP isteğinin **tüm** header'ları, backend isteğinde yoksa iletilir                                                                                 | Sadece declared carrier'lar (`authorization` default); `Identity.Project` ile projeksiyon                                                                                                                                                   | **Biz**; kapalı liste                                                                                                                                       |
| **Tags**                          | `meta.fastmcp.tags`; `GetTags`; `restrict_tag`                                                                                                      | `search_tools(tags)` AND filtresi; cevapta görünür tag sözlüğü; `@McpTool({ tags })` / `[McpTool(Tags)]` ile host beyanı (§12)                                                                                                              | **Berabere.** Onlarda ayrı bir `GetTags` var, bizde sözlük her cevapta; filtremiz tam eşleşme, onlarınki tag adıyla                                         |
| **Versiyonlama**                  | `version=`, `VersionFilter`, `_meta.fastmcp.version`                                                                                                | Yok; aynı handler'ın URI versiyonları tek tool'a katlanır                                                                                                                                                                                   | Bizim için alakasız; backend versiyonu route'ta                                                                                                             |
| **Katalog değişikliği**           | `list_changed` otomatik                                                                                                                             | `_meta["sk-mcp/catalogGeneration"]` + reload'da tek `listChanged`                                                                                                                                                                           | Parite                                                                                                                                                      |
| **Kaynak**                        | Herhangi bir dil, spec varsa                                                                                                                        | Framework başına SDK                                                                                                                                                                                                                        | Stratejik fark (§5)                                                                                                                                         |
| **Doğrulama**                     | pytest, tek implementasyon                                                                                                                          | Spec + 220 fixture + iki bağımsız implementasyon                                                                                                                                                                                            | **Biz**                                                                                                                                                     |

---

## 4. Alınabilecekler, öncelik sırasıyla

### 4.1 `outputSchema`'yı yüzeye çıkar — **sevk edildi (§8)**

`EndpointDescriptor.responses` zaten var ve Tablo 4 response şemasını readOnly üyeler korunarak yazıyor. Eksik olan tek şey `ToolDefinition`'a bir `outputSchema?` alanı ve `load_tool` cevabına eklenmesi.

- Birincil response: FastMCP'nin sırası makul (`200, 201, 202, 204`, sonra herhangi 2xx). JSON-uyumlu content type tercih edilir.
- Object olmayan kök için `{ "type": "object", "properties": { "result": … }, "required": ["result"] }` sarması. MCP `outputSchema`'nın object olması şartı buradan geliyor.
- `invoke_tool` sabit bir meta-tool olduğu için `structuredContent`, istemci tarafında statik şemayla doğrulanamaz. Bu yüzden şema `load_tool`'da yeter; `InvokeSuccess` değişmez. Karta tek satır `returns` eklenmesi ayrıca tartışılır.
- Spec: [metadata-contract.md](../../packages/spec/metadata-contract.md) tool definition tablosu, [search-semantics.md](../../packages/spec/search-semantics.md) meta-tool kontratı, `tool-definition.schema.json`. Fixture: `metadata-extraction` altına 3–4 vaka (object kök, array kök, 204 boş, 2xx yok).

### 4.2 Invoke payload bütçesi ve timeout — **sevk edildi (§9)**

Karar kaydı: [invoke-korumalari-karari.md](invoke-korumalari-karari.md). Spec: [invoke-semantics.md](../../packages/spec/invoke-semantics.md).

Bu maddenin ilk hali kesmeyi (`truncated: true` + `bodyPreview`) öneriyordu ve **yanlıştı**: preview, kapının koruduğu bütçenin tamamını harcayıp kullanılamaz bir parça verir, kesik diziden cevap üretilemeyeceği için retry'ı zaten zorunlu kılar, ve ajanın bayrağı atlayıp parçadan emin cevap verme riskini ekler. Üstelik `file-core` bu kararı ters yönde çoktan vermişti (reddeder), yani aynı üründe iki cevap olurdu.

Sevk edilen: **reddet, asla kesme**; üç meta-tool'da da; red `bytes`/`limit`/`shape` ve tool'un kendi daraltıcı argümanlarını taşır. `invoke_timeout` yalnız deadline dolduğunda, `retryable: true`. İptal L0/L1/L2 merdiveni olarak normatif ve L2 asla vaat edilmiyor.

### 4.3 Parametre adlarını ve açıklamalarını indeksle — **sevk edildi (§10)**

FastMCP `_extract_searchable_text` name + description + her property'nin adı ve açıklamasını indeksler. Bizde `customerId` araması boş döner.

- Yeni alan `parameters`: `inputSchema.properties` anahtarları + property `description`'ları. Ağırlık `1.0` (route ile aynı). Tokenizasyon aynı süreçten geçer; `customerId` → `customer`, `id`.
- Spec: [search-semantics.md](../../packages/spec/search-semantics.md) alan tablosu. Fixture: `search` altına 2–3 vaka; mevcut fixture'ların skorları değişebilir, aynı değişiklikte güncellenir.

### 4.4 Argüman küratörlüğü — `ArgTransform` karşılığı

**Karar (17 Eylül 2026): bu katman kesinlikle yapılacak.** Tartışma "yapılsın mı" değil, "nasıl yapılsın". Gerekçe, ürün ilkesi olarak:

> sk-mcp'yi kullanan geliştiriciye, kendi API'sini ajana **kendi istediği şekilde** sunabilsin diye doğru araçları vermeliyiz. Backend'in DTO'su REST istemcileri için tasarlanmış; onu ajan için budamanın tek yolu DTO'yu değiştirmek olmamalı. Geliştirici endpoint'e dokunmadan bir argümanı gizleyebilmeli, kimlikten doldurabilmeli, yeniden adlandırabilmeli, açıklayabilmeli. Aksi hâlde sk-mcp "API'ni olduğu gibi yansıtır" seviyesinde kalır ve Lowin'in "auto-converted server kötüdür" eleştirisi bize birebir uyar.

Bu ilke katmanın kapsamını da belirler: FastMCP'nin `ArgTransform`'unu kopyalamak değil, **kendi mimarimiz üzerinde geliştirmek**. Bizim avantajımız caller identity'nin zaten elde olması (`Identity.Project`); FastMCP'nin `default_factory` ile dışarıdan uydurduğu "context-aware tool" deseni bizde birinci sınıf olabilir.

Somut örnek. Backend'de `GET /orders` şu query DTO'sunu alıyor: `tenantId` (zorunlu), `q`, `lim`, `fq`, `includeDeleted`. Bugün tool aynen bu beş argümanla çıkar: ajan `tenantId`'yi bilmez, `fq`'nun ne olduğunu anlamaz, `includeDeleted`'a "belki lazım" diye dokunur. Küratörlük katmanıyla geliştirici şunu yazar:

```ts
@Get("orders")
@McpTool({
  name: "find_orders",
  description: "Search the caller's orders by keyword.",
  arguments: {
    tenantId:       { hide: (caller) => caller.claims.tenant },
    q:              { name: "keyword", description: "Free-text search" },
    lim:            { name: "max_results" },
    fq:             { hide: "status:active" },
    includeDeleted: { hide: false },
  },
})
list(@Query() q: ListOrdersQuery) { ... }
```

Ajanın gördüğü `find_orders(keyword: string, max_results: integer)`; backend'e giden istek hâlâ `GET /orders?tenantId=acme&q=…&lim=…&fq=status:active&includeDeleted=false`. Backend ve DTO değişmedi. (Sözdizimi örnek amaçlı; C# karşılığı attribute ya da `options` delegate'i olur, ADR karar verir.)

Per-endpoint, host tarafında sunulacak üç işlem:

- `rename(arg, newName)` — ajanın gördüğü isim değişir, template wire adını korur.
- `hide(arg, value | (caller) => value)` — argüman şemadan düşer, değer template zamanında ya çağrı zamanında caller'dan doldurulur. `tenantId`'yi `Identity.Project`'ten doldurmak FastMCP'nin "context-aware tool factory" deseni; bizde daha doğal çünkü caller identity zaten var.
- `describe(arg, text)` — property description'ı ezer.
- Kısıtlar: gizlenen argüman `unknown_argument` allow-list'inden çıkar (ajan gönderirse hata); `argument-mapping` fixture'ları etkilenmez çünkü `compose` girdisi hâlâ düz argüman nesnesi. `rename` sonrası isim çakışması `argument_collision` ile aynı kapıdan geçer. `hide` ile doldurulan değer identity taşıyıcısı olamaz; "identity is never an argument" kuralı korunur.
- **Bu ADR yazıldı:** [arguman-kuratorlugu-karari.md](arguman-kuratorlugu-karari.md). Aşağıdaki dört soru orada cevaplandı — (a) şablon çağıran başına türetilmez, `compose` çözülmüş değerleri saf JSON olarak alır; (b) gizlenen değer aynı tip kapısından ve aynı kodlamadan geçer; (c) `fields[].name` tel → ajan takma adıyla geri çevrilir, gizli alan adsız yayılır; (d) kart ve `load_tool` küratörlenmiş yüzeyi görür. Ayrıca kararda iki soru daha kapandı: küratörlük şekil seçimini etkilemez, ve çağırana göre küratörlük yoktur.

### 4.5 `search_tools(detail)` — **sevk edildi (§11)**

`detail: "card" | "schema"`, default `card`. `schema` seçilirse sonuçlar `load_tool` çıktısıyla aynı şekli taşır ve bir tur atlanır. Context maliyeti `limit` ile birlikte ajana bırakılır. FastMCP CodeMode'un kendi bulgusu: büyük kataloglarda staged discovery daha iyi sonuç veriyor; yani default kart kalır.

### 4.6 Config seviyesinde seçim kuralı — **sevk edildi (§13)**

`options.selection.rule(descriptor) => "include" | "exclude" | undefined`. Global default ile container arasına oturur: kural bir değer döndürürse global default'u ezer, container/operation marker'ları onu ezer. `/admin/*`'ı attribute dolaşmadan dışlamak için. `naming.prefix` delegate'iyle aynı desen. `ambiguous_selection` semantiğine dokunmaz çünkü kural tek değer döndürür.

Sevk edilirken şekil değişti: tek delegate yerine sırasız bir kural listesi, ve girdi descriptor değil `route` + `method`. Gerekçe §13'te; karar kaydı [selection-rule-karari.md](selection-rule-karari.md).

### 4.7 `tags` filtresi — **sevk edildi (§12)**

`search_tools(tags?: string[])`, AND. Kartta göstermek gerekmez; filtre yeter. `tags` zaten descriptor'da ve indekste.

Sevk edilirken iki madde büyüdü: keşif yolu olmadan filtre sessiz boş sonuç üretirdi, o yüzden cevap görünür tag sözlüğünü taşıyor; ve iki SDK da tek tag (container adı) ürettiği için filtre "controller'a göre filtrele" demek olurdu, o yüzden host beyanı da girdi. Ayrıntılar §12.

### 4.8 Form ve multipart body

Şu an `unsupported_binding` ile endpoint düşer. `x-www-form-urlencoded` bizim field-mode body modeliyle birebir: aynı düz nesne, farklı encoding. Multipart/dosya ayrı iş: `contentEncoding: base64` TypeShape'te var, taşıyıcı yok. Öncelik düşük; gerçek backend'lerde upload endpoint'leri var.

### 4.9 `deepObject` query style ve cookie parametreleri

**Sevk edildi (deepObject yarısı) — §14.** İlk teşhis "wire iki SDK'da farklı olur ve fixture zorlaşır" idi; doğru ama eksikti. Ölçüldüğünde çıktı ki ASP.NET bracket'i **hiç bind etmiyor** (prefix testini geçip hiçbir leaf'e denk gelmiyor, DTO sessizce boş kalıyor) ve Express bracket'i default'ta parse **etmiyor**. Çözüm wire'ı bölmek değil girdiyi bölmek oldu: notation descriptor'a yazılıyor, composer determinizmi ve tek `expected`'lı fixture'lar duruyor.

**Cookie yarısı buraya ait değildi.** Açık bir tasarım sorusu değil, zaten kapalı: `argument-mapping.md:11` `Cookie`'yi ismen identity carrier sayıyor. Serileştirmeyle ilgisi yok. §5'e taşındı.

### 4.10 Küçükler

- FastMCP log'larında header redaksiyonu (`_SAFE_HEADERS`). Bizde carrier değerleri hiç loglanmaz, sadece hash. Parite var.
- Tool fingerprint reçetesi. Bizde `catalogGeneration` var; `products/chat` `tool_approval` zaten digest tutuyor. `load_tool`'a per-tool digest eklemek ucuz ama talep yok.
- Session-scoped visibility (`ctx.enable_components`). Bizim görünürlük backend kararından türer, session state'inden değil. Ajanın "finans tool'larını aç" demesi bizim modele yabancı; host isterse `selection.rule` + reload ile benzer etki alır.

---

## 5. Kopyalanmayacaklar ve açık tartışma noktaları

**Kopyalanmayacaklar**

- **Component `auth` = görünürlük + enforcement.** FastMCP `call_tool` proxy'si, ismi katalogda göremiyorsa çağırmaz; görünürlük enforcement'a dönüşür. Bizim invariant 1 tam tersi ve doğru: iki gerçek kaynağı zamanla ayrışır, enforcement backend pipeline'ında kalır.
- **Sessiz çözümler.** `_2` suffix, unknown-arg drop, 56 karakter kesme, `route_map_fn` hata verirse "using defaults". Spec bunları yasaklıyor; kalsın.
- **Tam body hata geçişi.** Leak filter kalır; 401 body asla.
- **Tüm MCP header'larını iletme.** Kapalı carrier listesi kalır.
- **GET → Resource eşlemesi.** FastMCP bunu istemci uyumluluğu için terk etti; tools-only kararımızı doğruluyor.
- **`in: cookie` parametreleri.** `argument-mapping.md:11` `Cookie`'yi ismen identity carrier sayıyor — "identity is never an argument". Ajanın kimlik taşıyan header'ın içine yazması demek olurdu. Tersine dönmesi için görünürlük/kimlik modelinin değişmesi gerekir, serileştirmenin değil.

**Tartışma noktaları**

1. **Çakışmada suffix mi kök argüman mı.** FastMCP `id__path` ile şemayı düz tutar ama route `{id}` derken argüman `id__path` olur. Biz `{"id": 7, "body": {"id": 7}}` ile iki slotu açıkça adlandırırız. Bizimki Tablo 6'nın tek ilkesiyle ("kayıpsızsa düzleştir") tutarlı, istisna değil. Öneri: değiştirmemek.
2. **OpenAPI'yi kaynak olarak kabul etmek.** Core'a bir `OpenAPI → EndpointDescriptor[]` adaptörü eklenirse sk-mcp, Go/Java backend'leri için gateway olur. Kaybedilen: replay pipeline'ı, probe, guard okuma, visibility'nin tamamı. Kalan: isimlendirme, şema kuralları, argüman kompozisyonu, hata haritalama, search. Bu üçüncü bir ürün şekli olur (`file-core` gibi ayrı paket, `core`'a bağımlı). Teknik değil stratejik karar; bu notta öneri yok.
3. **Kart açıklaması 160 karakter.** FastMCP kesmez. Bizde tam metin `load_tool`'da. `detail: "schema"` gelirse (§4.5) bu soru kendiliğinden kapanır.
4. **Meta-tool sayısı.** FastMCP iki (`search_tools`, `call_tool`), biz üç. `detail` knob'u ile `load_tool` opsiyonel hâle gelir ama kaldırılmaz: `load_tool`'un görünürlük filtresine tabi olması (`unknown_tool` cevabı) spec'in bir parçası.

---

## 6. Önerilen sıra

| Adım | İçerik                                                                                          | Spec dokunuşu                                                | Fixture                                   |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| 1    | §4.1 `outputSchema` **(tamamlandı, §8)** + §4.2 payload bütçesi ve timeout **(tamamlandı, §9)** | metadata-contract, search-semantics, error-mapping; iki şema | metadata-extraction, error-mapping        |
| 2    | §4.3 parametre indeksleme **(tamamlandı, §10)**                                                 | search-semantics alan tablosu                                | search                                    |
| 3    | §4.5 `detail` **(tamamlandı, §11)** + §4.7 `tags` **(tamamlandı, §12)**                         | search-semantics meta-tool kontratı                          | yeni kind `detail`, search                |
| 4    | §4.6 `selection.rules` **(tamamlandı, §13)**                                                    | selection-hierarchy `## Config-level rules`                  | selection                                 |
| 5    | §4.4 argüman küratörlüğü                                                                        | **Tamamlandı** (§7)                                          | mevcut dört kind genişledi, yeni kind yok |
| 6    | §4.8 form body                                                                                  | schema-conversion-rules Tablo 7, argument-mapping            | argument-mapping                          |

Adım 1 ve 2 küçük spec değişikliği + fixture ile kapanır. **Adım 5 sıradan çıktı ve önce sevk edildi** — gerekçesi ve sonucu §7'de. **Adım 1 iki yarısıyla da kapandı: `outputSchema` §8'de, payload bütçesi ve timeout §9'da; adım 2 §10'da, adım 3'ün `detail` yarısı §11'de.** Adım 3 §12 ile tümüyle kapandı, adım 4 §13 ile; adım 6 ve §4.9 talep gelince. **Açık kalan tek madde §4.8 form/multipart body ile §4.9.**

---

## 7. Güncelleme — 17 Eylül 2026

Bu bölüm notun yazılmasından sonra ne değiştiğini kaydeder. Yukarıdaki §1–§6 kasıtlı olarak o günkü hâlinde bırakıldı; yalnız §3'ün küratörlük satırı, fixture sayısı ve §6'nın 5. adımı bu bölümle tutarlı olacak şekilde güncellendi.

### Ne sevk edildi

§4.4 uygulandı. Sıradaki beşinci madde olmasına rağmen önce yapıldı: §6'nın sıralaması iş büyüklüğüne göreydi, karar ise ürün ilkesine dayanıyordu ve ilke sıraya değil önceliğe işaret ediyordu.

- **Karar kaydı:** [arguman-kuratorlugu-karari.md](arguman-kuratorlugu-karari.md) — yüzey, dört yapısal taahhüt, yedi değişmez, bilinçli kapsam dışı bırakılanlar.
- **Normatif spec:** [packages/spec/argument-curation.md](../../packages/spec/argument-curation.md). `endpoint-descriptor.schema.json` `arguments` ve `variants` alanlarını kazandı; `fixture.schema.json` dört mevcut kind'ın girdisini genişletti. Üretilmiş tipler iki dilde yenilendi.
- **Kural katmanı:** tek çözümleyici iki tüketiciye veriyor — `packages/core/src/curation.ts` ve `SkMcp.AspNetCore/Curation.cs`. Şablon iki ad taşıyor (tel + ajan), `compose` üçüncü bir saf parametre (`deferred`) alıyor, deny-list serbest biçimli gövdede bile geçerli, doldurulan değerler ajanın gönderdiğiyle aynı tip kapısından ve aynı kodlamadan geçiyor.
- **Host yüzeyleri:** Nest'te `arguments` + `hidden.value/from/omit` + `curate<T>()` + `@McpVariant` + `options.arguments.provide/curate/seal/everywhere`; ASP.NET'te `[McpArgument]`, `[McpToolVariant]`, `McpToolAttribute.Description`, `options.Arguments`.
- **Yol üstünde kapanan parite boşluğu:** `extra.authInfo` Nest'te sınırda atılıyordu; artık `OuterRequest.auth` olarak okunuyor ve görünürlük de bundan faydalanıyor.
- **Fixture:** 35 yeni, toplam 207. Yeni kind eklenmedi; dört mevcut kind'ın girdi şekli genişledi ve 167 eski fixture değişmeden geçti.
- **Dokümantasyon:** yeni how-to sayfası `apps/docs/.../08-curate-the-arguments-an-agent-sees.md`, yapılandırma referansı ve iki SDK README'si.

### Ne değişmedi

Notun geri kalan maddeleri açık: §4.1 `outputSchema` (§8'de kapandı), §4.2 payload bütçesi ve timeout (§9'da kapandı), §4.3 parametre indeksleme, §4.5 `detail`, §4.6 `selection.rule`, §4.7 `tags`, §4.8 form/multipart body, §4.9 `deepObject` ve cookie. §5'in kopyalanmayacaklar listesi ve dört tartışma noktası aynen duruyor.

Küratörlüğün kendisinde de bilinçli sınırlar var ve karar kaydında gerekçeleriyle yazılı: şema daraltma yok, görünür `default` yok, argüman yeniden sıralama yok, açıklama silme yok, çağırana göre küratörlük yok.

### Kapatılan açıklar

İlk sevkiyatta üç tanı spec'te yazılıp implementasyonda karşılanmamıştı; üçü de kapatıldı ve kapatırken iki tanı daha eksik çıktı.

| Açık                                                                    | Ne yapıldı                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curation_unused_on_kept_route`                                         | Çözümleyici opsiyonel bir `CurationRelief` alıyor (`FoldedNames` + `OnUnused`). Katlanan route'ların placeholder'ları tel adı sözlüğünü veriyor — bir operasyonun route'ları arasında yalnız path parametreleri farklılaşabildiği için descriptor taşımaya gerek kalmadı. İki katalog da relief'i üretiyor, `metadata-extraction` fixture'ı `foldedRoutes` alanıyla kuralı üç runner'da birden sabitliyor |
| `curation_leaks_name`, `curated_open_body`, `variant_indistinguishable` | ASP.NET kataloğuna eklendi; `curation_leaks_name` aynı `ToolIndex.Tokenize` üzerinden çalışıyor, yani iki SDK aynı sezgiseli paylaşıyor                                                                                                                                                                                                                                                                   |
| `ambiguous_curation`                                                    | Aynı özgüllükteki iki merkezi kural aynı argümanı farklı değerle beyan ederse fatal, iki SDK'da da. Seviyeler arası ezme sessiz kalmaya devam ediyor — kural o                                                                                                                                                                                                                                            |
| `sealed_curation_overridden`                                            | **Nest'te ölü koddu:** mühürlü katmanlar en sonda uygulandığı için kontrol hiç ateşlenemiyordu; C#'ta ise hiç yoktu. Mühürlü adlar artık birleştirmeden **önce** toplanıyor ve iki SDK da ihlali fatal olarak bildiriyor                                                                                                                                                                                  |
| Sözleşme boşluğu                                                        | Merdiven ve mühür kuralları spec'te yazılı değildi, yalnız kodda vardı. `argument-curation.md`'ye "Where declarations come from" bölümü olarak girdi                                                                                                                                                                                                                                                      |

### Doğrulama

Üç runner da koştu.

| Süit                 | Sonuç                                                |
| -------------------- | ---------------------------------------------------- |
| `@sk-mcp/core`       | 360/360                                              |
| `@sk-mcp/sdk-nestjs` | 325/325 (17 atlanan, hepsi gerekçeli "unproducible") |
| `@sk-mcp/sdk-dotnet` | 170/170, net8.0 ve net10.0                           |
| `pnpm validate`      | 207/207                                              |
| `pnpm check-types`   | 24/24                                                |
| `pnpm boundaries`    | 1714 dosya temiz                                     |
| `dotnet build`       | 0 uyarı, 0 hata                                      |

Testlerin yakaladığı ve derlemenin yakalayamayacağı üç gerçek hata vardı: iki TS runner'ı `naming` fixture'ının `variants` alanını descriptor'a hiç taşımıyordu; `@McpVariant` yığını varyantları kaynakta yazılanın **tersi** sırada yayınlıyordu (metot decorator'ları aşağıdan yukarı çalışır); ve 13 yeni `metadata-extraction` fixture'ı Nest round-trip'inin kapsam kontrolüne hiç kaydedilmemişti. Sonuncusunu kapatırken 11 fixture gerçek decorator'larla üretilir hâle geldi, yani küratörlük yüzeyi artık `@McpTool`/`@McpVariant`'tan descriptor'a kadar uçtan uca sabitli.

---

## 8. Güncelleme — 17 Eylül 2026

§4.1 sevk edildi. Karar kaydı [outputschema-karari.md](outputschema-karari.md), normatif spec [packages/spec/metadata-contract.md](../../packages/spec/metadata-contract.md) `## Producing outputSchema`.

**Ne sevk edildi.** `ToolDefinition` isteğe bağlı bir `outputSchema` alanı kazandı ve `load_tool` bunu yayınlıyor. Değer `EndpointDescriptor.responses`'tan türetiliyor; descriptor alanı zaten vardı ve Tablo 4 onu `readOnly` üyeler korunarak yazmayı çoktan zorunlu kılıyordu — eksik olan yalnız türetme kuralı ve yüzeydi. Dokuz kural iki SDK'da aynı ve fixture ile sabitli: birincil response `200, 201, 202, 204` bu sırayla, sonra kalan 2xx'lerin en küçüğü; seçilen response `schema` taşımıyorsa (204) ya da hiç 2xx yoksa alan yazılmaz; object olmayan kök `{"result": S}` ile sarılır çünkü MCP kökün object olmasını şart koşuyor; sarmada `$defs` doküman köküne kalkar, yoksa her referans bağlantısız kalır; `$id` taşıyan kök kendi çözüm tabanını taşıdığı için kaldırılmaz; `additionalProperties` yazılmaz, çünkü response backend'in kendi şekli ve kısıtlanan taraf ajan değil; küratörlük `outputSchema`'ya dokunmaz, bir operasyonun bütün `variants`'ı aynı şemayı yayınlar; ve alan yokken anahtar `undefined`/`null` olarak değil, **hiç** yazılmaz — 35 mevcut `metadata-extraction` fixture'ı bu sayede bayt bayt aynı kaldı. 3 fixture `expected`'ını genişletti, 5 yeni vaka eklendi; 202 → **207**.

**Neden.** Ajan tool'un **ne göndereceğini** biliyordu, **ne alacağını** bilmiyordu. Çok adımlı plan bundan kör kalıyordu: "önce order'ı çek, `customerId`'sini al, sonra müşteriyi çek" zinciri ancak birinci çağrının cevabı görüldükten sonra kurulabiliyordu. Lowin'in "atomik çağrı zincirleri" eleştirisinin bize düşen payı buydu.

**Ölçülmüş asimetri, ve kapatılışı.** .NET `responses`'ı ApiExplorer'ın `SupportedResponseTypes`'ından zaten dolduruyordu; Nest hiç doldurmuyordu ve doldurabilecek bir kaynağı **yoktu**. `@nestjs/common`'ın 30 metadata anahtarının hiçbiri dönüş tipi taşımıyor, ve TypeScript `emitDecoratorMetadata` dönüş tipini generic'i silerek yazıyor:

| Handler imzası                        | `design:returntype` |
| ------------------------------------- | ------------------- |
| `sync(): OrderDto`                    | `OrderDto` ✅       |
| `async promised(): Promise<OrderDto>` | `Promise` ❌        |
| `list(): OrderDto[]`                  | `Array` ❌          |
| `union(): OrderDto \| null`           | `Object` ❌         |
| tip beyanı yok / `void`               | `undefined` ❌      |

Gerçek bir controller'da handler'ların çoğu `async`, yani tek başına bu kaynak kullanılamaz. `@nestjs/swagger`'ın aynı işi çözmek için bir derleme zamanı transformer'ı yayınlaması sınırın bağımsız kanıtı. Cevap üç katmanlı merdiven oldu: `@McpTool({ responses })` birinci sınıf beyan; `swagger/apiResponse` metadata'sı string anahtarla okunur, yani `@ApiOkResponse` yazmış backend bedava kazanır ve `@nestjs/swagger` bağımlılık olmaz; ve `design:returntype`, yalnız `Promise`/`Array`/`Object`/`Function`/`undefined` dışındaysa. Desen `descriptionOf`'un zaten yaptığının aynısı, yani SDK'da yeni bir kavram doğmadı.

**Yan kapanış.** .NET, bir DTO hem request body hem response olduğunda şema tanısının iki kez raporlanmasını `reportedBefore` ile engelliyordu; TS tarafında karşılığı yoktu. `describe` artık raporladıklarını bir `Set`'te tutuyor.

**Bilinçli kapsam dışı.** `structuredContent` doğrulaması: `invoke_tool` sabit bir meta-tool, şeması çağrıdan çağrıya değişiyor, yani istemci onu statik şemayla doğrulayamaz — `outputSchema` backend'in **beyanı**, bir Swagger dokümanının statüsünde. Kartın `returns` satırı da eklenmedi; kart bütçesi büyük sonuç kümelerini okunur tutan şey ve `card` fixture'larına, `createCard`'a, `CardFor`'a hiç dokunulmadı.

**Ne değişmedi.** §4.2 payload bütçesi ve timeout, §4.3 parametre indeksleme, §4.5 `detail`, §4.6 `selection.rule`, §4.7 `tags`, §4.8 form/multipart body, §4.9 `deepObject` ve cookie açık. §5'in kopyalanmayacaklar listesi ve dört tartışma noktası aynen duruyor.

---

## 9. Güncelleme — 18 Eylül 2026

§4.2 sevk edildi. Karar kaydı [invoke-korumalari-karari.md](invoke-korumalari-karari.md), normatif spec [packages/spec/invoke-semantics.md](../../packages/spec/invoke-semantics.md) — composition ile backend yanıtı arasını tarif eden ilk doküman.

**Ne sevk edildi.** Yanıt bütçesi (üç meta-tool, 256 KiB, reddeder), invoke deadline'ı (30 000 ms), iptal merdiveni (L0/L1/L2, L2 asla vaat edilmez), her iki SDK'da tek bir çıkış noktası, ve C# tarafında `DelegatingMcpServerTool` üzerinden aşılamaz bir ikinci kapı. Şema tarafında `invoke-result.schema.json` üçüncü bir `oneOf` dalı kazandı (`SdkError`, `status` required değil); `BackendErrorCode` dokuz backend kodu olarak saf kaldı. 13 yeni fixture, toplam 220; yeni kind açılmadı.

**Yan kapanış.** `error-mapping.md` "SDK-side kodlarda `status` yoktur" diyordu ama şema `status`'ü required yapıyordu — yani `unknown_tool` zarfı kendi yayınlanmış şemasına uymuyordu. Kapandı, ve üç SDK-side kod ilk kez fixture'landı.

**Altı defekt kapandı**, üçü güvenlik/kararlılık sınıfında: yanıtı hiç bitirmeyen bir handler MCP çağrısını sonsuza kadar asıyordu; MCP SDK'sının kendi catch'i handler fırlatmalarını filtresiz yayıyordu; `extra.signal` hiç okunmuyordu. Ayrıntılar karar kaydının §3 ve §4'ünde.

**Ne değişmedi.** §4.6 `selection.rule`, §4.7 `tags`, §4.8 form/multipart body, §4.9 `deepObject` ve cookie açık (§4.3 bir gün sonra §10'da, §4.5 §11'de kapandı). §5'in kopyalanmayacaklar listesi ve dört tartışma noktası aynen duruyor.

---

## 10. Güncelleme — 18 Eylül 2026

§4.3 sevk edildi. Normatif spec [packages/spec/search-semantics.md](../../packages/spec/search-semantics.md); yeni karar kaydı yok, çünkü karar notun kendisindeydi ve kapsam küçüktü.

**Ne sevk edildi.** Altıncı indeks alanı `parameters`, ağırlık `1.0`: tool'un yayınlanmış `inputSchema`'sının **kök** `properties` girdilerinin anahtarları ve — varsa — o property'nin `description`'ı. Kaynak descriptor değil, `tool.inputSchema`; küratörlük `buildInputSchema`'nın içinde çözüldüğü için gizli argüman indekse yapısal olarak giremiyor ve yeniden adlandırılan argüman yalnız ajan adıyla (`as`) giriyor. Filtreleme adımı yok, olmayacak da. 7 yeni fixture, toplam 227; yeni kind açılmadı.

**Üç karar, üçü de daraltma yönünde.**

- **Ad ve açıklama ayrı dizi elemanı, asla birleştirilmez.** Birleştirme tesadüfen güvenli ama güvenliği yazılı olmayan bir ayraç-sınıfı varsayımına dayanıyor: `tokenize("ORDER") ++ tokenize("id")` = `{order, id}`, ama `tokenize("ORDERid")` = `{orde, rid}` — akronim sınırı `R`→`i`'de ateşleniyor. Ayrı eleman ayracı sözleşmeden tümüyle çıkarıyor ve iki SDK'nın birikim döngüsünü mevcut `tags` döngüsünün kopyası hâline getiriyor.
- **Yalnız kök derinlik.** Kartın gösterdiği küme ile birebir aynı; daha derini `$ref`/`$defs` çözümü ister ve iki bağımsız implementasyonun erişilebilirlik ve döngü kuralları üzerinde anlaşmasını gerektirir — ayrışma sonucu okuyana görünmez olurdu.
- **Sıra pinlenmiyor.** `tf`, `df` ve doküman uzunluğu sırasız çoklu-küme üzerinde toplam, ağırlıkların tümü tam ikili kesir, yani JS'in tamsayı-anahtar öne alması ile .NET'in doküman sırası arasındaki fark gözlemlenemez. Spec bunu açıkça yasaklıyor, ve bir gün `parameters`'a uzunluk bütçesi konursa sıranın gözlemlenebilir hâle geleceği uyarısını taşıyor.

**Kapanan parite açığı.** `summarizeParameters`'ın `properties === undefined` guard'ı kopyalansa iki SDK ayrışacaktı: `properties: null` ve `null` bir üye şema TS'te `TypeError` atarken C#'ın `is JsonObject` guard'ı boş dönüyor — yani "TS katalog kurulumu patlarken .NET patlamıyor". Yeni projeksiyon her iki tarafta da `unknown` daraltmasıyla yazıldı: eksik/null/nesne-olmayan `properties` hiçbir şey katmıyor, nesne olmayan üye yalnız anahtarını katıyor, string olmayan `description` hiçbir şey katmıyor. Bu şekiller fixture'a giremiyor (`SearchTool.inputSchema` `JsonSchemaObject`'e `$ref` veriyor ve Ajv `strict`), o yüzden iki SDK'da eşli birim testiyle sabitlendiler — notun "fixture pinler" önermesinin bilinen tek deliği.

**Kart projeksiyonu da aynı kapıdan geçirildi.** `summarizeParameters` / `Summarize` çifti bu değişikliğin parçası değildi ama aynı hatayı taşıyordu ve ayrışıyordu; ölçüldü ve düzeltildi. Patlama yeri ciddiydi: `summarizeParameters`'ın tek çağıranı `createCard`, onun da tek çağıranı `search_tools`'un sonuç döngüsü — yani bozuk şemalı **tek** bir tool, katalogun tamamının keşfini istek anında düşürüyordu, C# tarafı ise bozuk kartı sessizce geçiyordu. Dört karar iki tarafta da aynı: nesne olmayan `properties` boş özet, nesne olmayan üye `any`, string dizisi olmayan `required` hiçbir şey işaretlemez, tip birleşimi ilk **string** üyesini alır ve diğerlerini atlar (TS'in `find`'ı string olmayanı döndürüyordu, C#'ın `TypeOf`'u atlıyordu). Beş eşli birim testi iki SDK'da, spec cümlesi `## The compact card` altında.

**Fixture'lar bilerek non-vacuous.** C# runner'ı fixture şemasına karşı tip denetlenmiyor; runner düzenlemesi düşerse `inputSchema` hiç okunmaz ve testler sessizce geçebilirdi. Yedi fixture'ın altısı projeksiyon atlanınca kırılıyor; yedincisi (`nested-and-defs-parameters-not-indexed`) kasıtlı olarak vacuous çünkü ters hatayı — fazla hevesli özyinelemeyi — koruyor, ve non-vacuous eşi `root-parameter-description-still-indexed` ile birlikte duruyor. Ayrıca `C5_SearchFixtures_AllPass` artık en az bir fixture'ın `inputSchema` taşıdığını doğruluyor.

**Mevcut 14 fixture değişmedi**, ve gerekçe yapısal: alan opsiyonel, hiçbiri taşımıyor, ve her fixture kendi `ToolIndex`'ini kurduğu için `N`/`df`/`avgLen` fixture başına. Notun §4.3'teki "mevcut fixture'ların skorları değişebilir" öngörüsü bu yüzden geçersiz kaldı.

**Bilinen limit, spec'e yazıldı.** `b = 0.75` uzunluk normalizasyonu yüzünden geniş `inputSchema`'lı bir tool'un **her** terimi — adındakiler dahil — düşüyor; 40 dokümanlı property taşıyan bir operasyon, eşit eşleşen dar bir operasyonun altında sıralanabiliyor. Alanı kırpmak reddedildi: kırpma noktası iki implementasyonun anlaşması gereken keyfî bir sabit olur ve kendisi normatif hâle gelirdi. Yüzeyi daraltmak ranker'ın değil küratörlüğün işi.

**Kapanan takip.** `curation_leaks_name` yalnız `${tool.name} ${tool.description}`'ı tarıyordu. Yeniden adlandırılan ya da gizlenen bir argümanın küratörlenmiş açıklaması host prozudur ve hâlâ tel adını söyleyebilir (`"tenantId ile filtrele"`); o proz artık `parameters` altında indekse girdiği için hata sınıfı değişti — "tool'u açınca kafa karıştıran cümle" değil, "keşif katmanı ajanı, `invoke_tool`'un reddedeceği bir terimle o tool'a yönlendiriyor". Aynı oturumda kapatıldı: yeni kod `curation_leaks_name_in_argument`, samanlık **yalnız host'un kendi `arguments` beyanlarındaki açıklamalar**, varyantın tam-kayıt değiştirmesi uygulanmış hâliyle. DTO'dan miras gelen açıklamalar bilerek taranmıyor: host onları küratörlerken yazmadı, ve `type`/`source` gibi tek token'lı tel adları sıradan şema prozuyla bir property kümesi ölçeğinde sinyali boğacak kadar çakışıyor. Ayrı kod, çünkü repo tanı şiddetini koda göre ayarlıyor — host bu sezgiseli tool-açıklaması olanını kaybetmeden susturabiliyor. `ResolvedCuration.CuratedDescriptions` / `curatedDescriptions` iki dilde de aynı birleştirmeyi yeniden yazmadan türetiyor: C#'ta `Resolve`'un içindeki merdiven `Declarations` olarak çıkarıldı, TS'te zaten özel olan `declarations` üzerine ince bir export kondu. Tanı iki SDK'da da uçtan uca testli; C# tarafında host'a özel minimal API endpoint'leriyle, çünkü bu assembly'de bildirilen bir controller `AddApplicationPart` üzerinden diğer bütün host testlerince keşfediliyor ve bu endpoint'ler bilerek sızdırıyor — minimal endpoint'ler host başına map'leniyor ve yerel kalıyor. `curation_leaks_name`'in kendisi de böylece ilk kez C# tarafında testlendi.

**Ne değişmedi.** §4.6 `selection.rule`, §4.7 `tags`, §4.8 form/multipart body, §4.9 `deepObject` ve cookie açık (§4.5 §11'de kapandı). §5'in kopyalanmayacaklar listesi ve dört tartışma noktası aynen duruyor.

---

## 11. Güncelleme — 18 Eylül 2026

§4.5 sevk edildi. Karar kaydı [search-detail-karari.md](search-detail-karari.md), normatif spec [packages/spec/search-semantics.md](../../packages/spec/search-semantics.md) `## The loaded shape`.

**Ne sevk edildi.** `search_tools` bir `detail: "card" | "schema"` argümanı kazandı, default `card`. `schema` seçildiğinde her sonuç, o tool için `load_tool`'un döndüreceği nesnenin aynısı oluyor ve ajan bir tur atlıyor. `detail` yalnız projeksiyonu seçiyor: sıralama, `limit`, `total` ve görünürlük filtresi etkilenmiyor, ve bir implementasyon `limit`'i `detail`'e göre yeniden yorumlayamıyor. 6 yeni fixture, toplam **233**; onuncu kind `detail` açıldı.

**Tek projeksiyon.** "Aynı nesne" iddiası iki inline literal ile taşınamazdı — `load_tool`'un yayınladığı şekil iki SDK'da da elle yazılmıştı ve paylaşılan tek projeksiyon kartı üretiyordu. `createDetail` / `DetailFor` çıkarıldı; TS'te tip üretilmiş `ToolDefinition`'dan `Pick` ile türetiliyor, yani `{ ...tool }` yazmak tip hatası ve `auth` sızıntısı derleyici tarafından kapalı.

**İki simetrik tuzak, ikisi de ölçüldü.** C# tarafında `detail` bir CLR enum olamazdı: `SkMcpJson.Wire` input-şema üretimine hiç ulaşmıyor, `McpJsonUtilities.DefaultOptions`'ta string converter yok, yani çıplak enum `{"type":"integer"}` yayınlıyor; string converter ise PascalCase değerler veriyor. Belirleyici olan şu: enum CLR tipiyle `"banana"` argüman bind'inde fırlatıyor ve metot hiç çalışmıyor. Seçilen `string` + `[AllowedValues]`, çünkü attribute yalnız şemayı süslüyor. TS'te ayna tuzak zod'da: `z.enum().default()` bilinmeyen değeri **reddediyor**, yani `[AllowedValues]` ile eşleştirilseydi aynı argümanda iki SDK ayrışırdı. `.catch("card")` ölçüldü — clamp ediyor ve yayınlanan şemayı değiştirmiyor.

**Bütçe.** `searchNarrowing` üçüncü bir girdi kazandı; red artık `detail`'i de adlandırıyor, yani ajan "limit'i küçült ya da karta dön" cevabını alıp tek turda düzeltiyor — en kötü hâl başabaş. Schema modunda daha düşük bir `limit` tavanı reddedildi: iki implementasyonun anlaşması gereken uydurma bir sabit olurdu ve `limit`'i başka bir argümanın değerine göre iki anlama gelir hâle getirirdi.

**İki eski açık kapandı.** `load_tool`'un yayınladığı şekli hiçbir fixture pinlemiyordu — yeni `detail` korpusu tek projeksiyon üzerinden ikisini birden sabitliyor. Ve spec'in status satırındaki "üç meta-tool iki framework'te aynı wire form'u yayınlar" iddiası hiçbir testle pinli değildi **ve yanlıştı**: TS `$schema` ile `z.number().int()`'in sayısal sınırlarını yayınlıyor, .NET ikisini de yayınlamıyor, anahtar sırası farklı, ve `apps/docs`'taki literal blok iki SDK'nın hiçbirine uymuyordu. İddia argüman kümesi, tipleri, default'ları ve cevap şekline daraltıldı; anahtar sırası ile dialect süslemesi framework detayı ilan edildi; ve ilk kez iki tarafta testle pinlendi (.NET `T16`, Nest'te karşılığı, ikisi de canlı `tools/list` okuyor).

**Ne değişmedi.** §4.6 `selection.rule`, §4.7 `tags`, §4.8 form/multipart body, §4.9 `deepObject` ve cookie açık. §5'in kopyalanmayacaklar listesi ve dört tartışma noktası aynen duruyor — ama §5'in 3. ve 4. tartışma noktaları bu sevkiyatla cevaplandı: kart açıklamasının 160 karakteri artık `detail: "schema"` ile aşılabiliyor, ve `load_tool` opsiyonel oldu ama kaldırılmadı, çünkü görünürlük filtresine tabi olması spec'in parçası.

---

## 12. Güncelleme — 18 Eylül 2026

§4.7 sevk edildi. Yeni karar kaydı yok; kararlar notun kendisindeydi, genişleyen iki madde aşağıda gerekçesiyle yazılı. Normatif spec [packages/spec/search-semantics.md](../../packages/spec/search-semantics.md) `## Filtering by tag`.

**Ne sevk edildi.** Üç parça, birlikte:

1. `search_tools`'ta opsiyonel `tags` argümanı — AND, **tag'in tamamı üzerinde katlanmış eşitlik**, `ToolIndex` içinde.
2. Cevapta `tags` sözlüğü — görünür tool'ların katlanmış, tekilleştirilmiş, ordinal sıralı tag kümesi.
3. Host tag beyanı — `@McpTool({ tags })` / `[McpTool(Tags = new[] { … })]`, `options.tags` / `options.Tags`.

14 yeni `search` fixture + 1 `metadata-extraction`, toplam **248**; yeni kind açılmadı. (İki fixture, yol üstünde kapatılan sigma açığına ait.)

**Neden madde büyüdü.** Notun lafzı "kartta göstermek gerekmez; filtre yeter" idi. İki şey bunu geçersiz kıldı. Birincisi: tag bugün ajana hiçbir yerde görünmüyor — kartta yok, `ToolDefinition`'da yok — yani keşif yolu olmayan bir filtre, yanlış tag'de sessiz boş sonuç demekti, ki §5'in "sessiz çözümler" listesinin tam karşıtı. Sözlüğü cevaba koymak FastMCP'nin `GetTags`'ini dördüncü bir meta-tool açmadan karşılıyor ve çağırana göre doğru. İkincisi: iki SDK da tek tag üretiyordu (container adı), yani AND semantiği yalnız fixture'larda test edilebilirdi ve filtre pratikte "controller'a göre filtrele" olurdu.

**Dört yapısal karar.**

- **Filtre `ToolIndex` içinde, meta-tool katmanında değil.** Conformance search fixture'ları `ToolIndex`'i doğrudan sürüyor; meta-tool katmanındaki bir filtreyi üç runner'ın hiçbiri pinleyemezdi ve iki implementasyon sessizce ayrışırdı.
- **Token'laştırma yok.** Sorgu prefix eşleşiyor, filtre tam eşleşiyor. `tokenize` uygulansaydı camelCase bölme ve trailing-`s` yüzünden `order` filtresi hem `Orders`'ı hem `OrderItems`'ı yakalardı — filtrenin işi daraltmak, o davranış genişletiyordu. Katlama aynı `foldToken`, yani büyük/küçük harf ve aksan affediliyor, anlam uydurulmuyor.
- **`df` tüm korpustan, filtre puanlamadan sonra, `limit`'ten önce.** Filtre hayatta kalanların sırasını asla değiştirmiyor, ve `limit` hayatta kalanları sayıyor. `tag-filter-preserves-document-frequency` bunu sıra-duyarlı olarak pinliyor: naif "önce filtrele" iki varyantının ikisi de aynı iki tool'u **ters sırada** döndürüyor.
- **Beyan değiştirir, birleştirmez.** `hints.name`, `hints.prefix` ve `McpToolAttribute.Description` hepsi türetilen değeri değiştiriyor; birleştirme tag'i sistemdeki tek kaldırılamaz beyan yapardı, ve dört controller'ı `billing` altında toplayan host dört container adını da yanında taşırdı.

**A0: yayınlanan şema paritesi, ilk kez ölçüldü.** §11 parite iddiasını "argüman kümesi, tipleri, default'ları" olarak daraltmıştı; `tags` bunu hemen zorladı. C#'ta bir dizi parametresinin varsayılanı derleme-zamanı sabiti olmak zorunda ve dizi tipinin tek sabiti `null`. Ölçüm: `string[]? tags = null` → `type: ["array","null"]`, `items: {"type":["string","null"]}` — zod'un hiçbir formuyla eşleşmiyor. `string[] tags = null!` → `type: "array"`, `items: {"type":"string"}`, `default: null`. Zod tarafında `.optional()` hiç `default` yaymıyor; `.meta({ default: null })` tam olarak o anahtarı ekliyor ve `parse` davranışını değiştirmiyor. İkisi artık aynı anahtarları aynı değerlerle yayınlıyor (sıra farkı spec'te zaten sözleşme dışı) ve **ilk kez iki tarafta da testle pinli** (.NET `T17`, Nest'te ikizi; açıklama metni ikisinde de birebir iddia ediliyor, çünkü iki süreçte koşan iki SDK'yı başka hiçbir şey karşılaştıramaz).

**Yol üstünde bulunan iki gerçek açık — ikisi de aynı sevkiyatta kapatıldı.**

- **`invoke_tool.arguments` parite ihlali — kapatıldı.** C# `JsonElement` olarak **required** ve tipsiz yayınlıyordu; Nest `z.record(z.string(), z.unknown()).default({})` ile opsiyonel ve `"type":"object"`. Yani aynı argüman bir SDK'da zorunlu, diğerinde değildi. Ölçünce altından ikinci ve daha ağır bir defekt çıktı: `z.record` nesne olmayan bir değeri **argüman bağlamasında** reddediyordu, yani `arguments: 5` ham `-32602 Input validation error` dönüyordu — zarfsız, leak filtresiz, `emitGuarded` hiç çalışmadan. §9'un handler fırlatmaları için kapattığı deliğin şema üzerinden geri açılmış hâli. C# tarafı ise değeri handler'a ulaştırıp ortak composer'ın `invalid_type` / "Arguments must be a JSON object." zarfını üretiyordu — yani doğru davranış C#'taydı ve Nest o kod yoluna hiç erişemiyordu. Çözüm tek tarafta: Nest `z.unknown().describe(…).nonoptional()`'a geçti. Ölçüldü: iki SDK artık `arguments` için yalnız `description` yayınlıyor (tip yok, bilerek), `required: ["name","arguments"]` ikisinde de aynı, ve `name`'in açıklaması da eşitlendi (Nest'te "Operation name." idi). `T18` ve Nest ikizi ile pinlendi; normatif cümle `search-semantics.md` meta-tool kontratına girdi.
- **Yunanca final sigma — kapatıldı.** `foldToken` iki dilde ayrışıyordu ve bu **token yolunu da etkiliyordu**, yani bu özelliğin ürünü değil. Ölçüldü: `ΟΔΟΣ` → JS `οδος` (U+03C2), .NET `οδοσ` (U+03C3); `ΣΟΦΟΣ` → `σοφος` / `σοφοσ`. Sebep: Yunanca'da küçük sigmanın konumsal iki formu var (`σ` kelime içi, `ς` kelime sonu) ama büyük harfi tek; yani `Σ`'nin küçültülmesi karakter hakkında değil konum hakkında bir karar. JS `toLowerCase` Unicode'un koşullu `Final_Sigma` kuralını uyguluyor, .NET `ToLowerInvariant` basit karakter eşlemesi yapıyor — ikisi de Unicode'a uygun, farklı seviyelerini uyguluyorlar. `İ`'nin aksine NFD kurtarmıyor, çünkü iki sigma da ayrışmıyor. Yön Unicode'un kendi `CaseFolding.txt`'inden geliyor (`03C2; C; 03C3`): katlamadan sonra `ς → σ`, iki dilde tek satır. Sonuç, bir kelimenin iki yazımının tek terim olması: `ΟΔΟΣ`, `οδος` ve `οδοσ` aynı indeksleniyor ve aynı eşleşiyor. İki fixture pinliyor (`final-sigma-folds-to-medial-sigma`, `tag-filter-folds-final-sigma`), ikisi de düzeltme olmadan TS'te kırılıyor. `ı`/`i` sınırıyla karıştırılmamalı — orada iki **ayrı harf** bilinçli olarak ayrı tutuluyor, burada aynı harfin iki yazımı yanlışlıkla ayrışıyordu. Korpusta Yunanca olmadığı için mevcut hiçbir skor değişmedi.

**Fixture yerine eşli birim testi, bir yerde bilerek.** Plan host beyanı için dört `metadata-extraction` fixture'ı öngörüyordu. Uygulamada ortaya çıktı ki o kind'ın `expected` yarısı `ToolDefinition` ve `ToolDefinition` tag taşımıyor, yani dört fixture core ve .NET runner'ları için birbirinin aynısı olurdu — reponun kendi vacuity standardının reddedeceği bir şey. Bunun yerine: **tek** fixture (`declared-tags-replace-container-tag`, gerçek decorator'la üretiliyor ve tag'in `ToolDefinition`'a sızmadığını pinliyor) artı iki SDK'da simetrik test dosyası (`tag-declaration.spec.ts`, `TagDeclarationHostTests.cs`), §10'un kurduğu eşli-test precedent'iyle. Aynı kapsam, doğru mekanizma.

**En büyük çapraz-SDK tuzağı.** `SelectionAttribute(…, operationOnly: false)` bir metot attribute'u varsa onu döndürüp sınıfa hiç bakmıyor. Metottaki çıplak bir `[McpTool(Name = …)]`, container'ın `Tags`'ini sessizce silerdi — Nest'in anahtar-anahtar `mergeHints`'i silmezken. `DeclaredTags` iki seviyeyi ayrı okuyor; `PrefixFor`'un bugünkü davranışı bilerek kopyalanmadı, çünkü `Prefix` nadir bir override ama container seviyesi tag'in birincil beyan yeri. İki SDK'da eşli testle pinli (`G4` / "keeps a container's tags…").

**Küçük ama yazılı iki sınır.** Sözlük 200 tag'i aşarsa **atlanıyor, asla kırpılmıyor**: narrowing ipuçlarının hiçbiri sözlüğü küçültmüyor (sözlük sorguyu değil katalogu tarif ediyor), ve kırpılmış bir liste ajana görmediği tag'in var olmadığını söylerdi. Ve beyan edilen tag yalnız **boş dizeye katlanırsa** düşüyor: yalnız boşluktan oluşan bir tag meşru ve eşleşebilir, çünkü onu tanımak iki SDK'nın paylaşmadığı bir boşluk sınıfı isterdi — tag'in hiç trim edilmemesiyle aynı gerekçe (JS `trim()` U+FEFF siliyor, .NET `Trim()` silmiyor).

---

## 13. Güncelleme — 19 Eylül 2026

§4.6 sevk edildi. Karar kaydı [selection-rule-karari.md](selection-rule-karari.md), normatif spec [packages/spec/selection-hierarchy.md](../../packages/spec/selection-hierarchy.md) `## Config-level rules`.

**Ne sevk edildi.** Seçim merdiveni dördüncü bir seviye kazandı: `operation` > `container` > **`rules`** > `global`. Bir kural `{ route?, method?, decision }`; `route` glob, `method` case-insensitive, ikisi de opsiyonel. 18 yeni `selection` fixture, toplam **266**; yeni kind açılmadı — `SelectionFixture.input` opsiyonel bir `rules`, `SelectionOperation` opsiyonel `route`/`method` kazandı ve mevcut 6 fixture bayt bayt aynı kaldı.

**Notun önerdiği şekil sevk edilmedi, ve gerekçesi ölçüldü.** §4.6 `rule(descriptor)` diyordu. İki şey bunu geçersiz kıldı. Birincisi: .NET seçimi `Describe`'dan **önce** yapıyor, Nest **sonra** — yani `EndpointDescriptor` seçim anında iki SDK'da birden elde değil; `route` ve `method` ise ikisinde de var. İkincisi: prior art taraması (FastMCP `RouteMap`, Speakeasy `filterOperations`, Stainless `unspecified_endpoints`, Swashbuckle `DocInclusionPredicate`, `@nestjs/swagger`) baskın şeklin tek delegate değil pattern→karar eşleşmesi olduğunu, ve pattern'in her yerde `method + path` aldığını gösterdi. İki bulgu aynı yere çıktı.

**Amerika keşfedilmedi.** Keşifte çıktı ki repo'da eşli, iki SDK'da çalışan bir route glob matcher **zaten var** ve argüman küratörlüğü `CurationTarget.route` için kullanıyor (`matchesRoute` / `RouteGlob.Matches`). Semantiği ölçüldü: `*` segment içi, `**` segment aşan, case-sensitive, `{id}` literal, ve **taban kural `**`, `*` değil**. Kendi prefix dilimizi yazmak aynı üründe iki route pattern dili doğururdu. Matcher ikisinden de çıkarılıp paylaşılan yere taşındı (`packages/core/src/route-glob.ts`, `Discovery/RouteGlob.cs`); seçim ve küratörlük artık aynı kapıdan geçiyor.

**FastMCP'den iki bilinçli ayrışma.** Regex pattern alınmadı — iki regex motoru, aynı pattern'in farklı eşleşmesi iki SDK'yı sessizce ayrıştırırdı. Ve **sıralı liste alınmadı**: "ilk eşleşen kazanır" tanımı gereği bir sessiz çözüm makinesidir, ki §5'in "Kopyalanmayacaklar" listesinin ilk maddesi tam olarak bu sınıf. Somut maliyeti: FastMCP'de listenin sonuna kural eklemek — doğal refleks — üstteki zaten eşleştiyse hiçbir şey yapmaz ve bunu söyleyen hiçbir şey yoktur. Özgüllük, adlandırılan alan sayısıdır; sıra hiç okunmaz.

**Küratörlükten tek sapma, gerekçeli.** `CurationTarget`'ta `method` özgüllüğe katkı yapmıyor; seçim kurallarında yapıyor. Sapma olmadan "`GET` açık, kalan method'lar kapalı" idiom'u yazılamazdı — iki kural aynı özgüllükte çelişip fatal olurdu. Küratörlükte bu boşluk yok çünkü orada `controller` ve `handler` gibi daha keskin seviyeler var; seçim kurallarının ikisi de yok. Küratörlüğün merdiveni değiştirilmedi.

**Normatif sonuç: config içinde carve-out yazılamaz.** `/admin/**`→exclude ile `/admin/health`→include ikisi de tek alan adlandırdığı için eşit özgüllüktedir, yani çelişkidir ve `ambiguous_selection` ile düşer. Carve-out'un yeri operation attribute'u. Pattern uzunluğuna göre alt-sıralama reddedildi: ürünün geri kalanının kullandığı merdivenin yanına ikinci, yalnız-kurallara-özel bir merdiven koyardı.

**Yol üstünde kapanan açık: `NormalizeRoute` ayrışması.** Kurallar `descriptor.route`'a karşı eşleştiği için route'un iki SDK'da aynı olması önkoşul oldu. Ölçüldü: `orders/` → Nest `/orders`, .NET `/orders/`; `a//b` → `/a/b` vs `/a//b`; boşluklu segmentler Nest'te trim'leniyor, .NET'te değil. Üçü de kapatıldı — C# `NormalizeRoute` artık TS gibi segment bölüp trim'liyor ve boş segmentleri düşürüyor. Bu yeni bir açık değildi; küratörlük aynı riski taşıyordu, ama seçim kuralları onu host'un birincil yüzeyine taşıdı. Dördüncü ayrışma (parametre son-eki: `{id:int}` → `{id}` ama `:id(\d+)` → `{id(\d+)}`) iki framework'ün kendi route sözdizimi olduğu için kapsam dışı bırakıldı ve `## Known limits`'e yazıldı.

**Ne değişmedi.** §4.8 form/multipart body ve §4.9 `deepObject` ve cookie açık. §5'in kopyalanmayacaklar listesi duruyor; tartışma noktalarından 3 ve 4 §11'de cevaplanmıştı, 1 ve 2 duruyor. Kapsam dışı bırakılanlar: `tags` boyutu (tag'ler seçimden sonra çözülüyor), controller `Type`'ını hedefleyen kural (tipi referans verebilen host onu decore de edebilir), ve route normalizasyonunun conformance korpusu.

**Ne değişmedi.** §4.6 `selection.rule`, §4.8 form/multipart body, §4.9 `deepObject` ve cookie açık. §5'in kopyalanmayacaklar listesi duruyor. Kapsam dışı bırakılanlar: varyant başına tag (varyantlar endpoint'in tag'lerini paylaşıyor, `auth`'u paylaştıkları gibi), karta `tags`, ve mühürleme (bir tag kuralını yenmek slot açmıyor, gruplama değiştiriyor — `naming.prefix`'in de mührü yok).

---

## 14. §4.9 sevkiyatı — `deepObject`, dile göre tel biçimi

Karar kaydı: [deepobject-karari.md](deepobject-karari.md).

**Notun teşhisi eksikti.** "Wire iki SDK'da farklı olur ve fixture zorlaşır" doğruydu ama asıl engeli kaçırıyordu. Ölçüm: ASP.NET'te `filter[status]` binder'ın prefix testini geçer, prefix'siz fallback'i **kapatır**, ama hiçbir leaf anahtarına denk gelmez — DTO sessizce boş bind olur, yani bracket gruplamamaktan **beter**. Ve Express 5 `query parser`'ı default'ta `'simple'`, yani bracket Nest'te de parse edilmiyor. Host `extended` demezse fatal `query_parser_not_extended` çıkıyor — Nest kataloğu lazy olduğu için startup'ta değil ilk meta-tool çağrısında. İki taraf da kendi biçimini istiyor; bu bir tercih değil.

**Değişmez bölünmedi, girdi bölündü.** Fixture'a SDK başına `expected` koymak `argument-mapping.md:5`'i ikiye bölerdi. Onun yerine `objectNotation` descriptor'a yazıldı: iki SDK farklı _girdi_ üretiyor — keşif zaten meşru biçimde farklı — composer aynı girdiye aynı baytı veriyor. Fixture'lar tek `expected` taşımaya devam ediyor. İkinci bir `style` değeri reddedildi; `deepObject` OpenAPI'nin bracket'e verdiği ad ve öyle kalmalı.

**Özelliğin asıl gerekçesi bulunan bir hataydı.** `[FromQuery(Name = "f")] FilterDto` bugün **bozuk**: ApiExplorer leaf'i `Status` diye bildiriyor, binder `f.Status` okuyor, sk-mcp `?Status=` yazıyor, DTO boş geliyor, hiçbir şey söylemiyor. `QueryObjectProbeTests.P4` bunu kurulu runtime'a karşı pinliyor; gruplama kapatıyor.

**Gruplama anahtarı ölçüldü, türetilmedi.** .NET'te ApiExplorer DTO'yu sk-mcp görmeden düzleştiriyor; geri toplamanın anahtarı `ReferenceEquals(a.ParameterDescriptor, b.ParameterDescriptor)`. Dört ayrı davranış varsayımının hepsi `QueryObjectProbeTests` ile pinli, çünkü hiçbiri ASP.NET sözleşmesi değil — kurulu framework'ün davranışı.

**Varsayılan `flatten`.** Açmak her etkilenen tool'un `inputSchema`'sını değiştirir **ve** küratörlük ad uzayını yeniden adlandırır (`curation.Of` artık var olmayan bir leaf'e çözülür). İkinci eksen opt-in'in daha güçlü gerekçesi. "Yalnız düzleştirmenin patladığı yerde grupla" reddedildi: `inputSchema`'yı ilgisiz kodun bir negatif özelliğine bağlardı.

**Yol üstünde kapanan üç sessiz hata.** `duplicate_argument` endpoint düşürüyordu ama iki severity tablosunda da yoktu, `warning`'e düşüyordu; düzleşen bir üye path parametresiyle çakışınca **tanısız** kayboluyordu (`query_member_shadowed` eklendi); ve yukarıdaki `[FromQuery(Name="f")]`. Üçü de `deepObject`'ten bağımsız, ayrı aşamada sevk edildi.

**Arama indeksiyle çarpışma ve çözümü.** Gruplama üye adlarını indeksten çıkarıyordu, ama `nested-and-defs-parameters-not-indexed.json` tam tersini pinliyor. Mevcut karar doğru — gövde keyfi derinlikte. Projeksiyon `grouped` kümesini ayrıca alıyor; yalnız `deepObject` parametrelerinin üyeleri indeksleniyor, varsayılan boş küme, gruplama kapalıyken davranış bayt bayt aynı.

**Ne değişmedi.** §4.8 form/multipart body hâlâ açık ve artık tek açık madde. Kapsam dışı bırakılanlar: ikiden fazla seviye (OpenAPI'nin kendisi tanımsız bırakıyor), nesne parametresinde `fill`, çıplak `@Query()`'nin gruplanması (Nest'te kusur olurdu), ve endpoint başına gruplama override'ı (host seviyesinde tek anahtar, iki SDK'da simetrik).
