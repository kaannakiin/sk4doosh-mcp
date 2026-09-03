# Önbellek

> Statü: **hipotez v0** — iki bağımsız doğrulaması (iki backend / iki framework) olmayan kural normatif değildir.

`search_tools`/`load_tool` sırasında tekrar tekrar hesaplanan iki değeri — çağıranın kimlik gerçekleri ve T2 probe verdict'i — çağıran başına önbellekler. Makine-okur karşılığı yoktur (zamanlama/state davranışıdır, veri dönüşümü değildir); doğrulama birim testleriyle yapılır.

## Kapsam

Çağıran scope'u başına önbelleklenenler:

- **`facts`** — T1 deklaratif katmanın `CallerFacts`'i (kimlik `present`/`absent`/`unknown` + policy sonuçları). Bugün her aramada backend'in kendi authentication'ı + N policy değerlendirmesiyle yeniden hesaplanır ([gorunurluk.md](gorunurluk.md) "Platform tarafı").
- **`probe:<toolName>`** — T2 probe'un yalnız `allow`/`deny` verdict'i (`unknown` önbelleklenmez; probe zaten bir daha denenmez — [gorunurluk.md](gorunurluk.md) T2 mekanik).

**Önbelleklenmeyenler:** tool tanımları ve BM25 index'i (global, çağırandan bağımsız snapshot; zaten memoize) ve `(çağıran, sorgu, limit)` sonuç listelerinin kendisi (sıralama zaten milisaniye-altı; ayrıca sonuç listesini önbelleklemek geçersiz kılma yüzeyini gereksiz büyütür). Katmanlama: arama her zaman `rank(global snapshot) ∩ overlay(çağıran)` şeklinde çalışır; `total` semantiği değişmez.

**Değişmez:** önbellek yalnız `search_tools`/`load_tool` altında okunur. **`invoke_tool` hiçbir zaman önbelleğe bakmaz** — yaptırım her zaman gerçek pipeline'dadır ([gorunurluk.md](gorunurluk.md) değişmez 1). Önbellek hatası her zaman miss'tir; hiçbir okuma başarısız olduğu için isteği düşürmez.

## Anahtar

Önbellek `CallerScope(Key, Tags)` üzerinden anahtarlanır:

- **`Key`** — 64 karakterlik küçük-hex SHA-256 özeti. Özetin girdisi spec'e sabitlenir ve iki SDK'da birebir aynıdır: beyan edilen kimlik taşıyıcıları ([karar 001](../../docs/kararlar/001-kimlik-tasiyicilari.md)) lowercase adlarına göre ordinal sıralanır, her biri `lowercase(name)=value\n` satırına yazılır (çok değerli header'lar `,` ile birleşir; taşıyıcı dış istekte yoksa satırı boş kalır). Bu digest girdisi (`DigestInput`) hem C# hem TS'te public ve saftır — host onu sarıp kendi tag'ini ekleyebilir.
- Taşıyıcı değerleri **hiçbir yerde düz metin tutulmaz** — yalnız özetlenmiş `Key` saklanır ve loglanır.
- **`Tags`** — default resolver tag üretmez. `user:42`, `tenant:7` gibi hedefli geçersiz kılma tag'leri host'un işidir (aşağıya bkz). Biçim `kind:value`, boşluksuz; `Key` içinde `:` bulunmaz (Redis segment güvenliği).

Aynı taşıyıcılar aynı `Key`'i üretir → aynı önbellek girdisini paylaşır; farklı çağıran farklı `Key` alır. Bu, mekanik olarak T2 probe'un zaten kullandığı "taşıyıcı özeti + tool adı" ilkesinin genellenmiş halidir.

## Ad alanı

Her anahtar `skmcp:v1:{scope}:{kind}[:{subkey}]` biçiminde seri hale getirilir (`{scope}` = `CallerScope.Key`, `{kind}` = `facts` ya da `probe`, `{subkey}` = `probe` için tool adı, `facts` için yok). Sürüm öneki (`v1`) kodlama değiştiğinde eski girdilerin sessizce yanlış yorumlanmasını engeller.

## Ömür

- Yaşam süresi, **scope'un ilk yazımından itibaren mutlak**tır (kayan/sliding değil) — bu, kabul edilen en yüksek staleness'ın (bayatlığın) üst sınırıdır.
- SDK her `Set` çağrısında ömre **%10'a kadar negatif jitter** uygular: gerçek sona erme, beyan edilen `Lifetime`'dan biraz erken olabilir, asla geç olmaz. Amaç dağıtık bir depoda (çok instance) eşzamanlı sona ermeyi kırmaktır; vaat edilen üst staleness sınırı hiçbir zaman aşılmaz.
- `Lifetime == 0` → önbellek tamamen devre dışıdır: `Get`/`Set` hiç çağrılmaz, her istek yeniden hesaplanır.
- `MaxCallers` aşıldığında **en az yakın zamanda kullanılan (LRU) scope** düşürülür; düşürme yalnız **yeni bir scope kabul edilirken** değerlendirilir (her yazımda değil).

## Geçersiz kılma

Üç operasyon (`ISkMcpCacheInvalidator`):

| Operasyon               | Etki                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `InvalidateCallerAsync` | Yalnız bir `CallerScope`'un tüm girdileri (`facts` + tüm `probe:*`).                                                           |
| `InvalidateTagAsync`    | O tag'i taşıyan tüm scope'lar (host'un tag üretmesi şart — default resolver tag üretmezse bu operasyon hiçbir şeyi etkilemez). |
| `InvalidateAllAsync`    | Tüm önbellek, tüm scope'lar.                                                                                                   |

**Sinyal her zaman manueldir** — sk-mcp hiçbir backend olayını (yetki değişikliği, kullanıcı güncellemesi) kendiliğinden dinlemez; host kendi yetki değişim noktasında (rol ataması, izin revoke) bu üç operasyondan birini çağırır. Tag köprüsü, "backend kullanıcı id'sini bilir, sk-mcp yalnız taşıyıcı özetini bilir" boşluğunu kapatır: host kendi `user:{id}` tag'ini üreten bir `ICallerScopeResolver` yazarak `InvalidateTagAsync("user:42")`'i backend'in kendi kullanıcı kimliğiyle çağırabilir.

**Uçuş kuralı:** bir geçersiz kılma çağrısı tamamlandıktan sonra, bu process içinde, çağrıdan **önce** yazılmış hiçbir girdi etkilenen scope'lar için bir daha gözlenmez. Çağrı sırasında **uçuşta** olan (okuma başlamış, henüz yazılmamış) bir hesaplama tamamlanabilir, ama epoch guard'ı onu geri yazmaz (aşağıya bkz — cache-aside okuma anında gözlenen epoch hâlâ güncelse yazar).

**Katalog reload'u tümünü temizler:** `SkMcpCatalogProvider.ReloadAsync()` sırası — yeni snapshot inşa edilir → `Generation` artar → `ISkMcpCache.ClearAsync()` çağrılır → değişiklik token'ı sinyallenir. Bu, `facts`/`probe` ayrımı gözetmeden **tüm** önbelleği temizler; katalog değiştiyse eski bir tool için önbelleklenmiş verdict artık anlamsızdır.

**`_disabled` probe kümesi yalnız katalog değişiminde temizlenir**, hiçbir yetki geçersiz kılma operasyonunda değil. Bu küme, probe'un kalıcı olarak vazgeçtiği endpoint'leri tutar (işaretsiz `2xx` gibi belirsiz bir yanıt görüldüğünde — [gorunurluk.md](gorunurluk.md) T2 "Karar"). Neden yalnız katalog: küme **yapısal bir gerçeği** kaydeder (route eşleşmedi ya da işaretsiz bir başarı görüldü — handler koşmuş olabilir), yetki durumunu değil; bir yetki olayında yeniden açmak, handler'ın koşma riskini geri getirir ki bunun için katalog gerçekten değişmiş (yeni deploy, yeni endpoint kaydı) olmalıdır.

## Değişmezler

1. `invoke_tool` önbelleğe asla bakmaz.
2. Önbellek bir güvenlik sınırı **değildir**; yaptırım her zaman gerçek pipeline'dadır ([gorunurluk.md](gorunurluk.md) "İki eksen").
3. Önbellek hatası (adaptör exception fırlatırsa) her zaman **miss** olarak ele alınır ve loglanır — istek düşmez, yeniden hesaplanır.
4. Hiçbir implementasyondan **key tarama** (`SCAN`, `KEYS *`) beklenmez; tüm operasyonlar scope/tag/generation üzerinden O(1)'e yakın çalışacak şekilde tasarlanmıştır.
5. Eşzamanlı aramalar tek hesaplamayı paylaşır (single-flight, process-içi): aynı çağıranın çakışan aramaları aynı `facts`/`probe` hesabını bir kez koşturur, sonucu paylaşır.

## Dağıtık kurulum

Varsayılan implementasyon (`MemorySkMcpCache`) tek process'e özeldir: çok instance'lı bir dağıtımda her instance kendi önbelleğini tutar ve `Lifetime` süresi içinde birbirinden bağımsız yakınsar — geçersiz kılma çağrıları yalnız çağrıldıkları process'i etkiler. Paylaşılan (Redis vb.) bir `ISkMcpCache` adaptörü isteyen host şu garantileri sağlamalıdır:

- `GetAsync`/`SetAsync` string değer taşır; sk-mcp'nin kendi kompakt kodlaması (`facts` için `P|OrdersRead=A;Owner=U` biçimi, `probe` için tek karakter `A`/`D`) kullanılır — adaptörün genel bir serializer sözleşmesine ihtiyacı yoktur.
- Scope başına gruplu depolama önerilir (ör. Redis `HASH`, alan adları `kind[:subkey]`): bir çağıranı tek operasyonla düşürmek (`InvalidateCallerAsync`) O(1) olmalıdır.
- Tag → scope kümesi eşlemesi ayrı bir yapıda tutulmalıdır (ör. Redis `SET` başına tag); `InvalidateTagAsync` bu kümeyi okuyup ilgili scope'ları düşürür, tüm anahtar uzayını taramaz.
- `ClearAsync` bir jenerasyon/epoch sayacını arttırmak kadar ucuz olmalıdır; tüm anahtarları tek tek silmek zorunlu değildir (`MemorySkMcpCache` bunu iki sözlüğü `Interlocked.Exchange` ile değiştirerek yapar).

## Mekanik / politika tablosu

Karar 003'ün cetveli burada da geçerlidir: doğru cevap host'a göre değişen her şey `options.Cache` altında düğmedir; tek doğru cevap olan her şey düğmesiz mekaniktir.

| Konu                                                        | Tür      | Nerede                                                                        |
| ----------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| Önbellek ömrü, LRU sınırı                                   | Politika | `options.Cache.{Lifetime, MaxCallers}`                                        |
| Anahtar türetimi (digest girdisi)                           | Mekanik  | `CarrierHashCallerScopeResolver.DigestInput` — sealed, saf, iki dilde birebir |
| Tag üretimi                                                 | Politika | `ICallerScopeResolver`'ı ez (default tag üretmez)                             |
| Negatif jitter, mutlak TTL, `_disabled` kuralı, uçuş kuralı | Mekanik  | Düğmesiz; SDK garantisi                                                       |
| Depo (bellek içi / dağıtık)                                 | Politika | `ISkMcpCache`'i ez (TryAdd)                                                   |
| Geçersiz kılma sinyalinin ne zaman geleceği                 | Politika | Host'un işi; SDK yalnız `ISkMcpCacheInvalidator` yüzeyini verir               |

## `Identity.Project` ile ilişki

[gorunurluk.md](gorunurluk.md)'nin daha önce "önbelleği kapat" dediği durum artık bir geçersiz kılma sorunudur: `Identity.Project` dış istek dışında bir kaynaktan (saat, sayaç, veritabanı) değer türetiyorsa, o değişken taşıyıcı özetinde görünmez ve `CallerScope.Key` onu izlemez. Doğru çözüm önbelleği kapatmak değil, o kaynağı da özete katan bir `ICallerScopeResolver` yazmaktır — `DigestInput`'u sarıp ek bir satır eklemek yeterlidir.
