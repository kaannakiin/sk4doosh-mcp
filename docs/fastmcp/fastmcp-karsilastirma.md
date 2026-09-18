# sk-mcp ↔ FastMCP OpenAPI Karşılaştırması

**Durum:** Tasarım notu. §4.4 (argüman küratörlüğü) karara bağlandı ([arguman-kuratorlugu-karari.md](arguman-kuratorlugu-karari.md)), spec'lendi ([packages/spec/argument-curation.md](../../packages/spec/argument-curation.md)) ve iki SDK'da uygulandı (§7). §4.1 (`outputSchema`) da sevk edildi ([outputschema-karari.md](outputschema-karari.md), §8); geri kalanı karar bekliyor
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

| Konu                              | FastMCP                                                                                                                                             | sk-mcp                                                                                                                                                                                                                                      | Değerlendirme                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **İsim çakışması**                | Sessiz `_2`; 56 karakterde sessiz kesme; `operationId` `__`'ye kadar                                                                                | `name_collision` fatal; 256 sınır + `long_tool_name` uyarısı; container prefix + tekrar bastırma; çoklu route → tek tool + `alternateRoutes` ([naming.md](../../packages/spec/naming.md))                                                   | **Biz.** Sessiz `_2`, komşu endpoint eklendiğinde mevcut tool'un adını kaydırır; ajanın öğrendiği isim kararsızlaşır                             |
| **Bilinmeyen argüman**            | Log warning, argüman sessizce düşer                                                                                                                 | `unknown_argument` + izinli isim listesi ([argument-mapping.md](../../packages/spec/argument-mapping.md) adım 1)                                                                                                                            | **Biz**                                                                                                                                          |
| **Parametre/body isim çakışması** | Parametre `id__path` olur, description'a "(Path parameter)" eklenir, body düz kalır                                                                 | Body `body` kök argümanına iner, `body_field_collision` uyarısı ([schema-conversion-rules.md](../../packages/spec/schema-conversion-rules.md) Tablo 6)                                                                                      | **Berabere, tartışılır** (§5)                                                                                                                    |
| **Body düzleştirme**              | Kök anahtarlar denetlenmez (`minProperties`, `propertyNames` kaybolur); `allOf` birleştirilir; `discriminator` alt tipleri hepsi opsiyonel düzleşir | Altı anahtarlık whitelist; dışında bir anahtar varsa kök argüman; `$id`/`$anchor` asla düzleşmez; optional body asla düzleşmez                                                                                                              | **Biz.** Onlarınki bilinçli "local strictness" fedası. Bizde TypeShape'ten `allOf` doğmaz; sadece `verbatim` host şemasıyla gelebilir            |
| **`default`**                     | Şemaya kopyalanır                                                                                                                                   | Yazılmaz; PATCH'te "yok" ile "açıkça default" farklı istekler                                                                                                                                                                               | **Biz**, gerekçeli                                                                                                                               |
| **Nullable**                      | 3.0 `nullable` → tip dizisi                                                                                                                         | Pinlenmemiş alan; IR'da nullable düğüm yok                                                                                                                                                                                                  | Parite gerekmez; bizim gerekçe spec'te                                                                                                           |
| **Array serileştirme**            | style/explode OpenAPI default'ları; path array virgül; `deepObject`; cookie                                                                         | Aynı default'lar; delimiter encoder'dan geçmez (iki dilin encoder farkı); boş array anahtar yazmaz; path array yasak; `spaceDelimited+explode:true` reddedilir                                                                              | Parite. `deepObject` ve cookie bizde yok (§4.9)                                                                                                  |
| **Path encoding**                 | `httpx`'e bırakılır                                                                                                                                 | Katı RFC 3986, `!'()*` dahil; ham birleştirme yasak (`5/../admin` tek segment)                                                                                                                                                              | **Biz**; fixture-pinned                                                                                                                          |
| **Body tipleri**                  | JSON, `+json`, `text/plain`, form-urlencoded, multipart (dosya)                                                                                     | Sadece JSON; form/file → `unsupported_binding`, endpoint düşer                                                                                                                                                                              | **FastMCP daha geniş** (§4.8)                                                                                                                    |
| **Hata haritalama**               | Tam body, 401 dahil, ajana akar; sızıntı filtresi yok                                                                                               | Dokuz kodlu sözlük, `retryable`, `fields`, `reference`; 401 body asla, 5xx body asla, HTML asla; pattern deny-list; host recognizer ([error-mapping.md](../../packages/spec/error-mapping.md))                                              | **Biz, açık ara**                                                                                                                                |
| **Output schema**                 | 2xx şeması `outputSchema`; `{result}` sarma; `structured_content`; `validate_output`                                                                | `load_tool` `outputSchema` döner; birincil response sırası 200/201/202/204, object olmayan kök `{result}` ile sarılır, `$defs` sarmalayıcı köke kalkar, readOnly korunur ([metadata-contract.md](../../packages/spec/metadata-contract.md)) | **Berabere** (§8). `structuredContent` doğrulaması bilinçli kapsam dışı: `invoke_tool` sabit meta-tool, şeması çağrı başına değişir              |
| **Discovery turu**                | `search_tools` tam tanım döner → 2 tur. CodeMode detay seviyeleri                                                                                   | kart → `load_tool` → `invoke_tool`: 3 tur; kart 160 karakter + `parameters` özeti                                                                                                                                                           | Onların docs'u büyük kataloglarda staged discovery'yi savunur = bizim default. `detail` knob'u bizde yok (§4.5)                                  |
| **Search algoritması**            | BM25 k1=1.5; NFKC casefold; prefix yok; alan ağırlığı yok; **parametre adları/açıklamaları indekste**                                               | BM25 k1=1.2; alan ağırlıkları; prefix eşleşme; NFD folding; sondaki `s`; fixture-pinned ([search-semantics.md](../../packages/spec/search-semantics.md))                                                                                    | Bizimki Türkçe için özellikle daha iyi. **Parametre adlarını indekslemiyoruz** (§4.3)                                                            |
| **Görünürlük**                    | enable/disable; session bazlı; allowlist; component `auth` hem gizler hem reddeder                                                                  | Üç değerli karar; T0–T2 ladder; probe; `authUncertain`; caller-scope cache; invariant 1: invoke asla visibility'ye bakmaz ([visibility.md](../../packages/spec/visibility.md))                                                              | **Biz.** Onlarınki MCP token'ına bağlı, backend yetkisinden habersiz. Bizde karşılığı olmayan tek şey session-scoped progressive disclosure (§5) |
| **Seçim**                         | Sıralı `RouteMap` (regex/tag), default her şey TOOL                                                                                                 | Üç seviye most-specific-wins; global default `exclude`; `ambiguous_selection` fatal ([selection-hierarchy.md](../../packages/spec/selection-hierarchy.md))                                                                                  | Bizimki default-deny. Onlarda config seviyesinde kural var, bizde attribute dışı kural yok (§4.6)                                                |
| **Transport / auth**              | OAuth server, OAuth/OIDC proxy, token verifier, `AuthMiddleware`, `InsufficientScopeError`                                                          | PRM + 401 decoration + audience kuralı; enforcement host'a bırakılır ([transport.md](../../packages/spec/transport.md))                                                                                                                     | Farklı roller: onlar auth **sağlar**, biz host'un auth'unu **kullanırız**. Tutarlı                                                               |
| **Middleware**                    | Rate limit, timing, caching, **response size limit**, custom hook                                                                                   | Yok. `invoke_tool`'da **payload bütçesi yok, timeout yok** (iki SDK'da da grep boş). `file-core`'da `maxPayloadBytes` var, HTTP katalogda yok                                                                                               | **FastMCP** (§4.2)                                                                                                                               |
| **Argüman küratörlüğü**           | `ArgTransform`: rename, hide + default/default_factory, description, type, required; `transform_fn`                                                 | `arguments` beyanı: `as`, `description`, `hidden` (`constant`/`deferred`/`omit`); `variants` ile tek endpoint'ten N tool ([argument-curation.md](../../packages/spec/argument-curation.md))                                                 | **Berabere**, kapsam farkı bilinçli: tip/zorunluluk değiştirme bizde kapsam dışı, çağırandan doldurma onlarda birinci sınıf değil (§4.4, §7)     |
| **Kimlik iletimi**                | MCP isteğinin **tüm** header'ları, backend isteğinde yoksa iletilir                                                                                 | Sadece declared carrier'lar (`authorization` default); `Identity.Project` ile projeksiyon                                                                                                                                                   | **Biz**; kapalı liste                                                                                                                            |
| **Tags**                          | `meta.fastmcp.tags`; `GetTags`; `restrict_tag`                                                                                                      | Sadece indeks alanı; kartta yok, filtre yok                                                                                                                                                                                                 | Küçük boşluk (§4.7)                                                                                                                              |
| **Versiyonlama**                  | `version=`, `VersionFilter`, `_meta.fastmcp.version`                                                                                                | Yok; aynı handler'ın URI versiyonları tek tool'a katlanır                                                                                                                                                                                   | Bizim için alakasız; backend versiyonu route'ta                                                                                                  |
| **Katalog değişikliği**           | `list_changed` otomatik                                                                                                                             | `_meta["sk-mcp/catalogGeneration"]` + reload'da tek `listChanged`                                                                                                                                                                           | Parite                                                                                                                                           |
| **Kaynak**                        | Herhangi bir dil, spec varsa                                                                                                                        | Framework başına SDK                                                                                                                                                                                                                        | Stratejik fark (§5)                                                                                                                              |
| **Doğrulama**                     | pytest, tek implementasyon                                                                                                                          | Spec + 220 fixture + iki bağımsız implementasyon                                                                                                                                                                                            | **Biz**                                                                                                                                          |

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

### 4.3 Parametre adlarını ve açıklamalarını indeksle

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

### 4.5 `search_tools(detail)`

`detail: "card" | "schema"`, default `card`. `schema` seçilirse sonuçlar `load_tool` çıktısıyla aynı şekli taşır ve bir tur atlanır. Context maliyeti `limit` ile birlikte ajana bırakılır. FastMCP CodeMode'un kendi bulgusu: büyük kataloglarda staged discovery daha iyi sonuç veriyor; yani default kart kalır.

### 4.6 Config seviyesinde seçim kuralı

`options.selection.rule(descriptor) => "include" | "exclude" | undefined`. Global default ile container arasına oturur: kural bir değer döndürürse global default'u ezer, container/operation marker'ları onu ezer. `/admin/*`'ı attribute dolaşmadan dışlamak için. `naming.prefix` delegate'iyle aynı desen. `ambiguous_selection` semantiğine dokunmaz çünkü kural tek değer döndürür.

### 4.7 `tags` filtresi

`search_tools(tags?: string[])`, AND. Kartta göstermek gerekmez; filtre yeter. `tags` zaten descriptor'da ve indekste.

### 4.8 Form ve multipart body

Şu an `unsupported_binding` ile endpoint düşer. `x-www-form-urlencoded` bizim field-mode body modeliyle birebir: aynı düz nesne, farklı encoding. Multipart/dosya ayrı iş: `contentEncoding: base64` TypeShape'te var, taşıyıcı yok. Öncelik düşük; gerçek backend'lerde upload endpoint'leri var.

### 4.9 `deepObject` query style ve cookie parametreleri

`filter[status]=x`. .NET model binder `filter.status` bekler, Nest `qs` `filter[status]` parse eder; wire iki SDK'da farklı olur ve fixture zorlaşır. Cookie parametresi bizde "identity taşıyıcısı argüman olamaz" kuralına çarpar; `Cookie` header'ı taşıyıcı. Her ikisi tartışılır, düşük öncelik.

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
| 2    | §4.3 parametre indeksleme                                                                       | search-semantics alan tablosu                                | search                                    |
| 3    | §4.5 `detail` + §4.7 `tags`                                                                     | search-semantics meta-tool kontratı                          | search, card                              |
| 4    | §4.6 `selection.rule`                                                                           | selection-hierarchy                                          | selection                                 |
| 5    | §4.4 argüman küratörlüğü                                                                        | **Tamamlandı** (§7)                                          | mevcut dört kind genişledi, yeni kind yok |
| 6    | §4.8 form body                                                                                  | schema-conversion-rules Tablo 7, argument-mapping            | argument-mapping                          |

Adım 1 ve 2 küçük spec değişikliği + fixture ile kapanır. **Adım 5 sıradan çıktı ve önce sevk edildi** — gerekçesi ve sonucu §7'de. **Adım 1 iki yarısıyla da kapandı: `outputSchema` §8'de, payload bütçesi ve timeout §9'da.** Adım 6 ve §4.9 talep gelince.

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

## 9. Güncelleme — 18 Eylül 2026

§4.2 sevk edildi. Karar kaydı [invoke-korumalari-karari.md](invoke-korumalari-karari.md), normatif spec [packages/spec/invoke-semantics.md](../../packages/spec/invoke-semantics.md) — composition ile backend yanıtı arasını tarif eden ilk doküman.

**Ne sevk edildi.** Yanıt bütçesi (üç meta-tool, 256 KiB, reddeder), invoke deadline'ı (30 000 ms), iptal merdiveni (L0/L1/L2, L2 asla vaat edilmez), her iki SDK'da tek bir çıkış noktası, ve C# tarafında `DelegatingMcpServerTool` üzerinden aşılamaz bir ikinci kapı. Şema tarafında `invoke-result.schema.json` üçüncü bir `oneOf` dalı kazandı (`SdkError`, `status` required değil); `BackendErrorCode` dokuz backend kodu olarak saf kaldı. 13 yeni fixture, toplam 220; yeni kind açılmadı.

**Yan kapanış.** `error-mapping.md` "SDK-side kodlarda `status` yoktur" diyordu ama şema `status`'ü required yapıyordu — yani `unknown_tool` zarfı kendi yayınlanmış şemasına uymuyordu. Kapandı, ve üç SDK-side kod ilk kez fixture'landı.

**Altı defekt kapandı**, üçü güvenlik/kararlılık sınıfında: yanıtı hiç bitirmeyen bir handler MCP çağrısını sonsuza kadar asıyordu; MCP SDK'sının kendi catch'i handler fırlatmalarını filtresiz yayıyordu; `extra.signal` hiç okunmuyordu. Ayrıntılar karar kaydının §3 ve §4'ünde.

**Ne değişmedi.** §4.3 parametre indeksleme, §4.5 `detail`, §4.6 `selection.rule`, §4.7 `tags`, §4.8 form/multipart body, §4.9 `deepObject` ve cookie açık. §5'in kopyalanmayacaklar listesi ve dört tartışma noktası aynen duruyor.
