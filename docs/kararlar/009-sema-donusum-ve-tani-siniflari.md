# Karar 009 — Şema Dönüşümü ve Tanı Sınıfları

Tarih: 2026-09-03. Durum: **kabul edildi** — [sema-hatti-acik-bulgular.md](../sema-hatti-acik-bulgular.md) denetiminin uygulaması bu kararı takip eder.

## Cetvel

[Karar 003](003-istek-ustverisi.md)'ün cetveli geçerlidir: host'a göre değişen (enum politikası, alan adı politikası, derinlik bütçesi) → genişletme noktası; tek doğru cevap olan (karar sırası, map ayrımı, `required` kaynağı) → sealed mekanik.

## Argüman çakışması neden `Fatal` değil

[arguman-eslemesi.md](../../packages/spec/arguman-eslemesi.md) parametre adı ile gövde alanı adının çakışmasını "tool üretim anında fail-fast" hata sayar. Denetim, kuralın _tespit edildiğini_ ama yanlış katmanda ve yanlış şiddette olduğunu gösterdi: şablon kurulumunda fırlatılıyor, uyarıya çevriliyor, `Template` null kalıyor, **tool yine listeleniyor** ve ancak invoke anında `not_invocable` dönüyordu. Agent bozuk bir tool görüyor, çağırıyor, tur kaybediyordu.

Doğru şiddet `EndpointDropped`, `Fatal` değil. `Fatal` kodlar (`name_collision`, `ambiguous_selection`, `invalid_name`) her invoke'ta `EnsureValid()` üzerinden kataloğun tamamını çağrılamaz yapar. Bunlar _global_ sorunlardır: iki endpoint tek kimliğe talip olduğunda doğru yönlendirme diye bir şey yoktur. Argüman çakışması ise _lokaldir_ ve kapsanmıştır — tam olarak bir endpoint kullanılamaz, diğer her tool doğrudur.

Ölçek bu yargıyı belirledi: path `id` + gövde `id` en yaygın çakışma şeklidir. 216 action'lı bir backend'de tek bir DTO hatasının 216 tool'u birden düşürmesi orantısızdır. CLAUDE.md **sessiz çözümü** yasaklar, düşürmeyi değil; `unsupported_binding` bu "tanı üret ve endpoint'i düşür" emsalini zaten kurmuştu.

Kademeli geçiş için `Diagnostics.Downgrade` uyarıya indirir (bugünkü davranış, ama artık _seçilmiş_ ve loglanmış), `Diagnostics.Escalate` fatal'e çıkarır. Downgrade'in gerçekten işe yaraması için şema üreticisinin çakışmada fırlatması **politikaya bağlıdır**: katı modda hata, indirilmiş modda bugünkü üzerine-yazma. Koşulsuz fırlatan bir üretici, kaçış kapağını ölü bırakırdı.

## Nesne olmayan gövdeler neden şimdilik düşürülüyor

`[FromBody] List<int>` gibi bir kök bugün **kısmen değil, tamamen ölüdür**: gövde hiç gönderilmez ve izin listesi boş kaldığı için her argüman `unknown_argument` ile reddedilir — üstelik hiçbir tanı üretilmez, çünkü hiçbir şey fırlatmaz.

Doğru uzun vadeli çözüm sentetik tek argümandır. Ama o argüman adının kendisi her parametreye karşı çakışma denetimine girmek zorundadır, `RequestTemplate`'e yeni bir gövde-kökü kavramı, `RequestComposer`'a ikinci bir gövde modu ve **NestJS ile paylaşılan** `argument-mapping` korpusuna normatif değişiklik gerektirir. Bu, mapper düzeltmesiyle aynı değişikliğe sığdırılamayacak ayrı bir iştir.

Ara çözüm çağrılamayan tool'u listelemeyi bırakmaktır: agent için yalanın kalkması katı iyileşmedir, operatör içinse endpoint nihayet bir log satırında adlandırılır. Çalışan hiçbir şey kaybolmaz.

Ayrım önemli: **map benzeri ve şekli bilinmeyen kökler düşmez, canlanır.** Sınır çıktısının `additionalProperties: true` taşıması ve şablon kurulumunun bu bayrağı nihayet iletmesiyle sözlük gövdeler, `JObject` gövdeler ve derinlikle daraltılmış gövdeler çağrılabilir hale gelir. Düşen küme yalnız gerçek dizi/skaler köklerdir.

## Enum politikası neden sorulur, taranmaz

Serileştirici ayarlarındaki converter listesini taramak üç sebeple yanlıştır: dahili enum converter'ı iki modu da işlediği için tip sorgusu ayrım yapamaz; tip-kapsamlı converter API'si SDK'nın desteklediği en eski hedef çerçevede yoktur; ve enum tipinin üzerindeki converter niteliği listede hiç görünmez.

Her üyeyi host'un kendi ayarlarıyla serileştirip sonucun türünü okumak çıkarım değil ölçümdür. Yan faydası belirleyici oldu: bu yöntem **isimlendirme politikasını da yakalar**. Denetim, camelCase politikalı bir host'ta bile şemanın ham PascalCase adları yazdığını gösterdi — yani hata yalnız sayısal host'larda değil, string host'larında da vardı.

## `additionalProperties` neden türetilir

`RequestComposer` bilinmeyen argümanı zaten reddediyordu; şema bunu söylemiyordu. Ama sabit `false` yazmak da yanlış olurdu: serbest gövdeler (sözlük, `JObject`) gerçekten ek anahtar kabul eder. Değer, şablonun `bodyAllowsAdditionalProperties`'ini besleyen **aynı yüklemden** türetilir. Bu paylaşım stilistik değildir: iki taraf ayrışırsa şema, composer'ın uymadığı bir sözleşme ilan eder ya da tersi.

Davranış regresyonu sıfırdır — kural zaten uygulanıyordu; yalnız hata daha erkene ve daha iyi mesaja taşındı.
