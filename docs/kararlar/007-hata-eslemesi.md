# Karar 007 — Hata Eşlemesi

Tarih: 2026-09-02. Durum: **kabul edildi** — Faz 4 uygulaması bu kararı takip eder.

## Cetvel

[Karar 003](003-istek-ustverisi.md)'ün cetveli burada da geçerlidir: host'a göre değişen (recognizer sırası, ham çıktı isteği) → genişletme noktası ([karar 006](006-genisletme-noktalari.md)); tek doğru cevap olan (sızıntı desenleri, status → kod eşlemesi, boru hattı sırası) → sealed mekanik, düğmesiz.

## 401 gövdesini asla iletmeme

Motokurye kanıtı bu kararın gerekçesidir: `JwtAuthenticationMiddleware`'in 401 gövdesi `{"error":"Unauthorized","message":"Portal resolution failed: " + ex.Message}` yazıyor. `ex.Message` iç bir exception'ın serbest metnidir — hangi portal çözümleyicisinin, hangi iç sebeple başarısız olduğunu söyleyebilir. Bu, [gorunurluk.md](../../packages/spec/gorunurluk.md) değişmez 4'ün ("gizlemek gerekçe bildirmez") kimlik doğrulama halidir: kimliksiz bir çağırana iletilebilir hiçbir 401 gerekçesi yoktur, çünkü kimlik kanalı zaten sabittir (MCP session'ın taşıdığı credential'lar) — aynı session'la yeniden denemek işe yaramaz, dolayısıyla gövdenin içeriği agent için hiçbir zaman eyleme dönüştürülebilir değildir, yalnız sızıntı riskidir. Karar: **401 gövdesi hiçbir koşulda, hiçbir filtreden geçse bile iletilmez** — düğme yoktur.

403 bilinçli olarak farklı davranır: kaynak-seviyesi bir red gerekçesi ("başkasının siparişi", "mesai dışı") agent'ın bir sonraki adımını değiştirebilir (farklı bir kaynağı dene, farklı zamanda dene); ayrıca 403'te varlık zaten ifşa olmuştur (endpoint görünür, argüman biçimi doğru kabul edilmiştir) — 401'in aksine gizlenecek ek bir şey yoktur. Bu yüzden 403 `detail`'i sızıntı filtresinden (aşağıya bkz) geçerse iletilir.

## 5xx gövdesini asla iletmeme

5xx bir backend hatasıdır; gövdesi neredeyse her zaman stack trace, iç exception mesajı ya da altyapı detayı taşır (motokurye örneği: `GlobalErrorHandlerMiddleware`'in `{"Succeded":false,"Message":"..."}`'i). Karar: **5xx gövdesi hiçbir koşulda iletilmez**; yalnız bir korelasyon kimliği (ProblemDetails `traceId`, ya da bilinen bir korelasyon header'ı) `reference` alanına taşınır — bu, agent'ın destek talebinde referans verebileceği opak bir dizedir, içerik değil. Sınır dürüstçe kabul edilir: motokurye'nin `Succeded=false` zarfında `reference` üretecek bir alan yoktur, dolayısıyla o durumda `reference` de boş kalır — sk-mcp uydurmaz.

## Tam iki genişletme noktası

- **(a) Mapper'ı tümüyle değiştir** — `IInvokeResultMapper`/`ExtensionPoints.invokeResultMapper` ([karar 006](006-genisletme-noktalari.md)). Ham çıktı isteyen ya da backend'e özgü bambaşka bir zarf isteyen host bu noktayı kullanır.
- **(b) Öne bir recognizer ekle** — `options.Errors.Recognize(ErrorRecognizer)`/`options.errors.recognize(fn)`. Yerleşik recognizer zincirinden önce koşar, ama çıktısı yine de sızıntı filtresinden geçer — recognizer eklemek filtreyi atlatmaz, yalnız hangi alanların "temiz mesaj" sayılacağını genişletir.

## Bilinçli eklenmeyen

- **Redact/post-process hook'u.** Filtre zaten mekaniktir ve her zaman açıktır; "filtrelemeden önce bir kere daha bakmak isteyen" host aslında (a)'yı istiyordur — mapper'ı değiştirmek.
- **Status başına mesaj override'ı.** Kod sözlüğündeki dokuz standart mesaj sabittir; bir host'un "kendi 404 mesajını" yazması, agent'a giden metnin backend'e göre değişmesi demektir — spec'in dil-bağımsızlık iddiasını (karar dokümanı 004) kırar.
- **i18n.** Standart mesajlar her zaman İngilizcedir (meta-tool'ların dili) — [arama-semantigi.md](../../packages/spec/arama-semantigi.md).
- **`Retry-After`'ın HTTP-date biçimini parse etme.** Yalnız saniye tam sayısı okunur; tarih biçimi ayrıştırma karmaşıklığı, kazandırdığı değere göre orantısızdır — dokümante bir sınır olarak kalır ([hata-eslemesi.md](../../packages/spec/hata-eslemesi.md) "Bilinen sınırlar").

## SDK-taraflı kodlar korunur

Argüman kompozisyonu ve katalog çözümlemesi sırasında üretilen kodlar (`unknown_argument`, `invalid_path_type`, `missing_path_parameter`, `header_injection`, `null_not_allowed`, `invalid_type` — [arguman-eslemesi.md](../../packages/spec/arguman-eslemesi.md); `unknown_tool`, `not_invocable`) backend'e hiç ulaşmadan üretilir, dolayısıyla dokuz koddan hiçbirine indirgenmez: aynen korunur, aynı zarfı (`error`, `message`, `retryable: false`) paylaşırlar, yalnız `status` alanı yoktur.

Tutarlılık için `load_tool`'un görünürlük tarafından gizlenen ya da gerçekten var olmayan bir tool için döndürdüğü `unknown_tool` de aynı `isError: true` + zarf biçimini kullanır — [gorunurluk.md](../../packages/spec/gorunurluk.md)'nin "`load_tool` görünürlüğe tabidir" bölümü artık bu tel biçimini varsayar.

## Reddedilen alternatif: allow-list-by-shape

Yalnız bilinen zarf biçimlerini (ProblemDetails, Nest exception, vb.) tanıyıp geri kalan her şeyi standart mesaja düşürmek düşünüldü ve reddedildi: motokurye'nin `BadRequest("callId zorunludur.")` gibi zarfsız düz 400 mesajları hiçbir bilinen biçime uymadığı için kaybolurdu — oysa bu mesajlar zaten temizdir ve agent için doğrudan eyleme dönüştürülebilirdir. Karar bunun yerine **yapısal kurallar + desen tabanlı deny-list** (hata-eslemesi.md "Sızıntı önleme" A/B) kullanır: zarf biçimini tanımayan ama hiçbir sızıntı deseni taşımayan bir mesaj iletilir.
