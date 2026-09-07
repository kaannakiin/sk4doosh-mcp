# Argüman Eşlemesi

> Statü: **iki implementasyonla doğrulandı** (ASP.NET Core + NestJS/Express, 2026-08-28; [karar 004](../../docs/kararlar/004-nestjs-dogrulamasi.md)) — normatif adayı. İkinci implementasyonun revize ettirdiği kurallar aşağıya işlendi.

Agent'ın düz JSON argümanları HTTP isteğine deterministik dönüşür. Girdi: istek şablonu (metod, route, parametre beyanları `in: path|query|header`, opsiyonel body beyanı) + argüman nesnesi. Çıktı: path+query string, veri header'ları, opsiyonel JSON body. Her SDK aynı girdiden **birebir aynı** çıktıyı üretmek zorundadır; [conformance](../conformance) `argument-mapping/` fixture'ları bunu sınar.

## Şablon üretim kuralları (tool üretim anında, fail-fast)

- Argüman adları tekil: parametre + body property adları çakışamaz (path `id` + body `id` dahil → hata; çözüm yeniden adlandırma/override). Sentetik gövde kökü adı (`body`) aynı denetime girer.
- `GET`/`HEAD` body beyan edemez.
- Header-konumlu parametre kimlik taşıyıcısı adı (`Authorization`, `Cookie`) kullanamaz — kimlik asla argüman değildir ([karar 001](../../docs/kararlar/001-kimlik-tasiyicilari.md)).
- Path parametresi dizi olamaz; her path parametresinin route'ta `{ad}` yer tutucusu olmalı (route kısıtları `{id:int}` şablonda soyulur), her yer tutucunun parametresi olmalı.

## Kompozisyon algoritması (çağrı anında, sırayla)

1. **Bilinmeyen alan reddi:** beyan edilmemiş argüman → `unknown_argument` hatası; mesaj izinli adları listeler. İzin listesi parametre adları + gövde alanları + (varsa) gövde kökü argümanıdır. Sessiz düşürme yasak.
2. **Path:** her path parametresi zorunlu (yoksa `missing_path_parameter`); tip kapısı (şablondaki tipe uymayan değer → `invalid_path_type` — aksi halde route kısıtı hatayı opak 404'e çevirirdi); değer percent-encode edilip yer tutucuya ikame edilir. Encode **RFC 3986 katıdır**: unreserved (`A-Z a-z 0-9 - . _ ~`) dışındaki her şey kodlanır — `!'()*` ve boşluk dahil (C#: `Uri.EscapeDataString`; JS: `encodeURIComponent` tek başına yetmez, `!'()*` ayrıca kodlanır; fixture: `percent-encoding-rfc3986`). **Ham yapıştırma yasak** — `"5/../admin"` tek encode'lu segment olur, traversal yapısal olarak imkânsız.
3. **Query:** absent → key hiç yazılmaz; `null` → `null_not_allowed`; dizi → beyan sırasıyla repeat-key (`?tag=a&tag=b`); key ve value ayrı ayrı percent-encode; parametreler beyan sırasında yazılır (çıktı string'i deterministik).
4. **Header:** değerde CR/LF/NUL → `header_injection`; veri header'ları kimlik taşıyıcılarından SONRA uygulanır (çakışma şablon kuralıyla zaten imkânsız).
5. **Body — iki mod.** _Alan modu_ (beyan edilen gövde alanları): parametrelere bağlanmamış beyan edilen alanlar tek JSON nesnesinde toplanır. _Kök modu_ (şablon bir gövde kökü argümanı beyan ettiyse, [sema-donusum-kurallari.md](sema-donusum-kurallari.md) Tablo 6): o argümanın değeri **gövdenin tamamıdır** — dizi, string, sayı ya da bool olabilir; argüman hiç gelmezse gövde gönderilmez ve kararı backend'in model binder'ı verir (`absent-query-omitted` ile aynı disiplin). İki mod aynı şablonda birlikte bildirilemez (`conflicting_body_modes`). Her iki modda `Content-Type: application/json; charset=utf-8` + `Content-Length`.

## Değer biçimlendirme

- Sayı/bool çevrimi **her zaman invariant** (`1.5` asla `1,5` olamaz) ve **kanonik en-kısa** serileştirmedir: kaynak metindeki artık gösterim korunmaz (`1.50` → `"1.5"`; fixture: `number-canonical-form`). Gerekçe: parse edilmiş değerle çalışan dillerde (JS) kaynak metin yoktur; kanonik form iki dilin doğal kesişimidir. Üstel gösterim gerektiren büyüklükler henüz fixture'lanmadı — pinlenmemiş alan.
- Tip kapısı path dışındaki konumlarda `invalid_type` üretir: argüman nesnesi JSON nesnesi değilse, dizi beyanlı parametreye dizi olmayan değer gelirse, ya da skaler çevrim başarısız olursa. `integer` tipi: kesirli değer ya da güvenli tam sayı aralığı (|n| ≤ 2^53−1) dışına taşan değer → `invalid_type`; `1.0` tam sayıdır → `"1"`. (Önceki "64-bit" sınırı JS'te temsil edilemiyordu; kural kesişime çekildi.)
- Semantik doğrulama (aralık, format, iş kuralı) SDK'nın işi DEĞİLDİR — backend'in kendi validation'ı çalışır; SDK yalnız güvenli kompozisyon yapar.
