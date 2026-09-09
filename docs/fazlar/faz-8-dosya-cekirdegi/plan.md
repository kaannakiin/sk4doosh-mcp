# Faz 8 — Dosya Kaynağı Çekirdeği

Durum: **tamamlandı** (kod tarafı). Karar kaydı [karar 015](../../kararlar/015-dosya-kaynagi-cekirdegi.md).

Bu faz [faz 7](../faz-7-web-ui/plan.md)'nin önünde koşuyor. Faz 7 bilinçli bir placeholder ("başlamadı", Faz 6 bittiğinde sıfırdan tasarlanacak) ve `apps/web` scaffold edilmedi; bu iş ondan bağımsız ve onu bloklamıyor.

## Hedef

`packages/excel-mcp` içindeki Excel'e özgü olmayan makineyi çıkarmak, böylece `xml-mcp`'nin işi "bir format adaptörü + bir kelime tablosu + bir tool listesi yaz"a inmek. Tetikleyici: 342 satırlık güvenlik testiyle korunan sandbox kodunu ikinci kez yazmak, iki kopyanın ayrışması ve ayrışan tarafın güvenlik katmanı olması demekti.

## Somut çıktılar

- `packages/file-core` (`@sk-mcp/file-core` 0.1.0, yayınlanan kütüphane): `errors`, `vocabulary`, `limits`, `formats`, `paths`, `listing`, `documents`, `cursor`, `tools`, `server`, `cli`, `unicode`.
- `packages/excel-mcp` 0.3.0, `@sk-mcp/file-core`'un ilk tüketicisi. `src` net −352 satır; `paths.ts` 327 → 58, `server.ts` 33 → 17.
- Tablo katmanı **çıkarılmadı** ama monomorfik hale getirildi: bağımlılık kapanışı yalnızca kendisi + `file-core`. Tetikleyici karar 015'te.
- `@sk-mcp/eslint-config/casing` opt-in named export; grid katmanı için `no-restricted-imports` koruması.
- CI: test filtresi tersine çevrildi (`--filter='!@sk-mcp/sdk-dotnet'`), npm publish-hazırlık kapısı eklendi.
- Kök `turbo.json`: `check-types.dependsOn` → `["^check-types", "^build"]`.

## Bitti kriteri

- `pnpm turbo run build check-types lint validate format:check` yeşil (27/27).
- `excel-mcp` 304 test, `file-core` 88 test, sıfır fail. `core` 280 ve `sdk-nestjs` 215 dokunulmadı ve yeşil.
- Paketlenmiş tarball'lar `check-npm-tarballs.py`'den geçiyor: `workspace:` protokolü sağkalmamış, `0.0.0` bağımlılığı yok, `dist/index.js` var, `.d.ts.map` yok.
- Grid katmanında sıfır format-adaptörü import'u.

## Ölçülen baseline

Taşıma öncesi: 20 spec dosyası, 340 test.

`excel-mcp` 340 → 304: `unicode.spec.ts` (14) `file-core`'a taşındı; `paths.spec.ts` 30 generic testten 7 bağlantı testine indi (25'i `file-core`'da duplikeydi, 4'ü `file-core`'da eksikti ve oraya eklendi, 1 excel'e özgü assertion korundu); dizin-sızıntısı regresyon testi (1) eklendi.

`file-core` sıfırdan 88 test: `paths` 30, `errors` 11, `unicode` 14, `cursor` 12, `documents` 12, `cli` 5, `server` 4. Hiçbiri exceljs istemiyor; suite `globalSetup`suz, saniyenin altında koşuyor.

Kural: generic bir özelliğin testi, o özelliği implemente eden pakette durur — `file-core`'un suite'i bütün tüketicileri korur, `excel-mcp`'de duran aynı test `xml-mcp` için hiçbir şey korumaz.

## Bu fazda kapatılan test boşlukları

- Doküman önbelleğinin hiç testi yoktu: tahliye, LRU yeniden sıralama, mtime/boyut geçersizleştirmesi, seçenek başına giriş, store izolasyonu.
- `cli.ts`'in hiç testi yoktu: argv şekli, usage/başlatma çıkış kodları.
- Sunucunun bildirdiği sürüm hiç doğrulanmıyordu.
- `guard`'ın stderr log'unun tetiklendiği hiç doğrulanmıyordu.
- Argüman **şekli** hatalarının yapılandırılmış zarfa girmediği hiç sabitlenmemişti.

## Bulunan ve düzeltilen hata

Kök içinde readable uzantı taşıyan bir **dizin** `resolveSourcePath`'ten geçiyor ve ajana tam mutlak yolu sızdırıyordu. Detay ve regresyon testleri karar 015'te.

## Takip işleri

- `text-encoding` çıkarımı: **kapandı — çıkarılmadı.** İkinci tüketici geldi ve ölçülen örtüşme yalnız BOM tablosuydu; o çekirdeğe alındı. `EncodingName`, `TextDecoder` ve `undecodable_text` tek tüketicili kaldı. Gerekçe [karar 016](../../kararlar/016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md).
- Tablo katmanının çıkarılması: ancak ikinci bir sunucu verisinin dikdörtgen görünümünü isterse.
- `packages/excel-mcp/src/index.ts` barrel'ının amaçlanan public yüzeye budanması: ilk publish'ten önce, ayrı bir karar olarak. Bilinen adaylar: `range.ts`'ten `advance` (dışa verilmiş, birim testli, production yolunda ölü).
- `apps/docs`'a `@sk-mcp/excel-mcp` için bir `how-to` sayfası: ilk gerçek publish ile, çünkü [dokuman-kurallari](../../../apps/docs/dokuman-kurallari.md) her kod örneğinin koşmasını gerektiriyor ve `npx @sk-mcp/excel-mcp` o zaman okuyucunun koşabileceği bir komut olur. Site şu anda excel-mcp'den hiç bahsetmiyor; bu gerçek bir boşluk.
- `@sk-mcp` npm scope'unun sahiplenilmesi. `paket-yerlesimi.md` bunu rename öncesi kontrol olarak kaydetmişti; kapatılmadı. Her iki paket de henüz yayınlanmadı (`npm view` → 404).
