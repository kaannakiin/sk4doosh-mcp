# `selection.rules` — Config Seviyesinde Seçim, Sırasız

**Durum:** sevk edildi — uygulama bu kaydı takip eder
**Tarih:** 19 Eylül 2026
**Kapsam:** `packages/http/spec`, `packages/http/conformance`, `packages/http/core`, `sdks/dotnet`, `sdks/nestjs`, `apps/docs` — HTTP katalog ürün hattı
**Kaynak tartışma:** [fastmcp-karsilastirma.md](fastmcp-karsilastirma.md) §4.6

---

## 1. Karar

Seçim merdiveni dördüncü bir seviye kazandı: host'un config'inde beyan ettiği `{ route?, method?, decision }` kuralları. Merdivendeki yeri `operation` > `container` > **`rules`** > `global`.

Kurallar **sırasızdır**. Ne kadar alan adlandırdıklarına göre sıralanırlar (`route`+`method` = 2, biri = 1, hiçbiri = 0); en özgül eşleşenler aynı kararı veriyorsa o karar uygulanır, farklı karar veriyorsa `ambiguous_selection` ile startup'ta düşer.

## 2. Neden — attribute'un yetişemediği yüzey

Bugüne kadar seçimin tek kaldıracı attribute'tu. `global: include` kurup `/admin`'i kapatmak, her admin controller'ına elle `@McpIgnore()` yazmak demekti: 40 controller = 40 dokunuş, ve 41.'yi ekleyen kişi unutursa endpoint sessizce ajana açılıyordu. Dokunulamayan yüzey (üçüncü parti controller, generated kod) için hiç yolu yoktu.

Bu, §4.6'nın tarifiydi ve doğruydu. Değişen tek şey, §4.6'nın önerdiği **şekil**.

## 3. FastMCP'den ayrışma — ve neden

§4.6 bir `rule(descriptor) => "include" | "exclude" | undefined` delegate'i öneriyordu. Prior art taraması (FastMCP `RouteMap`, Speakeasy `filterOperations`, Stainless `unspecified_endpoints`, Swashbuckle `DocInclusionPredicate`, `@nestjs/swagger`) iki şeyi gösterdi:

- Baskın şekil tek delegate değil, **pattern → karar** eşleşmesidir.
- Pattern her yerde `method + path` alır, tam operation nesnesini asla almaz.

İkincisi §4.6'nın kendi sorusunu da cevapladı: .NET seçimi `Describe`'dan **önce** yapıyor, Nest **sonra**, yani seçim anında `EndpointDescriptor` iki SDK'da birden elde değil. `method` ve `route` ise ikisinde de var. Dar girdi hem prior art'ın şekli hem de tek uygulanabilir olan.

Kopyalanmayan iki şey:

**Regex pattern.** FastMCP `RouteMap.pattern` regex alır. Bizde iki regex motoru var; aynı pattern'in .NET ve JS'te farklı eşleşmesi iki SDK'yı sessizce ayrıştırırdı. Glob güvenli altküme.

**İlk eşleşen kazanır.** Bu, tanımı gereği sessiz çözümdür: iki kural aynı endpoint'i tutar, biri sessizce kazanır. §5'in "Kopyalanmayacaklar" listesinin ilk maddesi tam olarak bu sınıf (`_2` suffix, unknown-arg drop, 56 karakter kesme). Üstelik reponun doktrini **most-specific-wins**, "declaration order wins" değil; ikisini aynı üründe karıştırmak host'a iki zihinsel model verirdi.

Sıra duyarlılığının somut maliyeti: FastMCP'de `/admin/**`→exclude ile `/admin/health`→include'un sonucu, hangisinin önce yazıldığına bağlıdır. Altı ay sonra listenin **sonuna** kural ekleyen kişi — ki doğal refleks budur — üstteki zaten eşleştiği için hiçbir şey yapmamış olur, ve bunu söyleyen hiçbir şey yoktur.

## 4. Amerika keşfedilmedi: matcher zaten vardı

Keşifte çıktı ki repo'da **eşli, iki SDK'da çalışan bir route glob matcher** zaten var ve argüman küratörlüğü `CurationTarget.route` için kullanıyor:

| SDK  | Konum                                                    |
| ---- | -------------------------------------------------------- |
| Nest | `matchesRoute`, `catalog.ts` içinde modül-private        |
| .NET | `RouteGlob.Matches`, `ArgumentCurationOptions.cs` içinde |

Semantiği ölçüldü: `*` segment içi, `**` segment aşan, `^...$` anchor, escape edilmiş literal, case-sensitive, `{id}` literal. **Taban kural `**`, `*` değil** — `*` bir bölü taşıyan route'u tutmaz.

Kendi prefix dilimizi yazmak aynı üründe iki route pattern dili doğururdu. Karar: matcher ikisinden de çıkarılıp paylaşılan yere taşındı (`packages/http/core/src/route-glob.ts`, `Discovery/RouteGlob.cs`) ve seçim ile küratörlük aynı kapıdan geçiyor.

## 5. Özgüllük — küratörlükten tek bilinçli sapma

`CurationTarget`'ın merdiveni `handler`=3, `controller|route`=2, global=1; `method` özgüllüğe **katkı yapmıyor**. Seçim kurallarında yapıyor: özgüllük, adlandırılan alan sayısıdır.

Gerekçe: sapma olmadan "`GET` açık, kalan method'lar kapalı" idiom'u **yazılamaz** — iki kural aynı özgüllükte çelişir ve fatal olur. Küratörlükte bu boşluk yok, çünkü orada `controller` ve `handler` gibi daha keskin seviyeler var; seçim kurallarının ikisi de yok.

Sapma tek yönlü: küratörlüğün merdiveni değişmedi (§4.4 sevk edilmişti, onu değiştirmek ayrı bir karardır).

## 6. Çelişki fatal, tekrar değil

Küratörlüğün `assertUnambiguous`'u zaten bu ayrımı yapıyor: aynı özgüllükteki iki kural aynı argümanı **farklı** beyan ederse fatal, **aynı** beyan ederse sorun değil. Birebir kopyalandı.

- `/admin/**`→exclude ve `/**/internal/**`→exclude, ikisi de `/admin/internal/x`'i tutuyor → sorun yok.
- `/admin/**`→exclude ve `/admin/health`→include → `ambiguous_selection`.

**Normatif sonuç: config içinde carve-out yazılamaz.** İkisi de tek alan adlandırdığı için hiçbiri daha özgül değil. Carve-out'un yeri operation attribute'u — zaten en özgül seviye.

Pattern uzunluğuna göre alt-sıralama reddedildi: ürünün geri kalanının kullandığının yanına ikinci, yalnız-kurallara-özel bir özgüllük merdiveni koyardı, ve "hangi glob daha özgül" sorusunu iki implementasyonun tek bir tamsayı için değil her pattern şekli için anlaşması gerekirdi.

## 7. Attribute config'i yener

Swashbuckle (`[ApiExplorerSettings(IgnoreApi)]` ApiExplorer'dan önce çalışır) ve `@nestjs/swagger` (`@ApiExcludeController`) istisnasız bu yönde; reponun kendi `tags` merdiveni de (`hints.tags ?? options.tags`) aynı. Gerekçe yereldir: attribute endpoint'in üstünde, kural `Program.cs`'te; daha yerel beyan daha özgül olandır. Tersi, `Program.cs`'teki bir satırın action'ın üstündeki `[McpIgnore]`'u sessizce ezmesi demekti.

FastMCP burada istisna: `route_map_fn` callback'i `EXCLUDE`'u ezebiliyor. Kopyalanmadı.

## 8. Yol üstünde kapanan açık: `NormalizeRoute` ayrışması

Kurallar `descriptor.route`'a karşı eşleştiği için route'un iki SDK'da aynı olması önkoşul oldu. Ölçüldü, dört ayrışma bulundu:

| Girdi                     | Nest (önce) | .NET (önce) |
| ------------------------- | ----------- | ----------- |
| `orders/` (sonda bölü)    | `/orders`   | `/orders/`  |
| `a//b` (boş segment)      | `/a/b`      | `/a//b`     |
| segment çevresinde boşluk | trim'lenir  | korunur     |

İlk üçü kapatıldı: C# `NormalizeRoute` artık TS gibi segment bölüp trim'liyor ve boş segmentleri düşürüyor. Bu **yeni bir açık değildi** — küratörlük `CurationTarget.route` ile aynı riski taşıyordu — ama seçim kuralları onu host'un birincil yüzeyine taşıdı.

Dördüncüsü (parametre son-eki: `{id:int}` → `{id}` ama `:id(\d+)` → `{id(\d+)}`) kapsam dışı bırakıldı ve `## Known limits`'e yazıldı: iki framework'ün kendi route sözdizimi, ve bir pattern'in parametre kısıtına uzanması zaten taşınabilir değil.

## 9. Bilinçli kapsam dışı

- **`tags` boyutu.** Tag'ler descriptor kurulurken çözülüyor, .NET'te seçim ondan önce. Tag çözümünü öne almak, dışlanan her endpoint'e hiç kullanmayacağı bir tag lookup'ı ödetirdi.
- **Controller `Type`'ı hedefleyen kural.** Tipi referans verebilen host onu decore de edebilir; o seviyenin adı `container`.
- **Küratörlüğün merdivenine method eklemek.** §4.4 sevk edilmiş, ayrı karar.
- **Route normalizasyon korpusu.** Route'un conformance korpusu yok, yalnız SDK-içi birim testleri var. Açmak ayrı bir iş.

## 10. Doğrulama

18 yeni `selection` fixture, toplam **266**; yeni kind açılmadı, `SelectionFixture.input` opsiyonel bir `rules` ve `SelectionOperation` opsiyonel `route`/`method` kazandı — mevcut 6 fixture bayt bayt aynı kaldı.

.NET runner ham `JsonElement` okuduğu için `Assert.True(ruled, "no selection fixture carried rules")` guard'ı eklendi; `C5_SearchFixtures_AllPass`'ın precedent'i.

Host seviyesinde eşli testler: `selection-rules.spec.ts` ve `SelectionRuleHostTests` / `SelectionRuleConflictHostTests`. İkisi de minimal API / ayrı modül üzerinde, çünkü `default: include` taşıyan bir host bu assembly'deki her controller'ı çekerdi.
