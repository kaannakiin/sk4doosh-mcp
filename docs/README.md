# docs — dizin ve belge sınıfları

Tarih: 2026-09-10. Bu dizin iki ürün hattının tasarım kaydını tutar: **HTTP kataloğu**
(`packages/core`, `sdks/*`) ve **dosya sunucuları** (`packages/file-core`,
`packages/excel-mcp`, `packages/xml-mcp`). 69 dosya, ~9.500 satır. Türkçedir;
`packages/spec` ve `apps/docs` İngilizcedir ve bu kuralın dışındadır.

Bu dosya bir giriş noktasıdır, kanıt kaydı değildir. Buradaki hiçbir sayı burada
tanımlanmaz; her satır sahibine bağlanır.

## Belge sınıfları

Her belge dört sınıftan birine girer. Sınıf, belgenin nasıl güncelleneceğini ve
silinip silinemeyeceğini belirler.

| Sınıf       | Ne taşır                                             | Kural                                                                                         |
| ----------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **KANIT**   | Ölçüm, CI koşusu bağlantısı, test sayısı, M-numarası | **Silinmez ve geriye dönük düzenlenmez.** Sonuç yanlışsa yeni kayıt açılır, eskisi durur      |
| **ADR**     | Kapalı, tarihli karar                                | Düzenlenmez. Düzeltme yeni numaralı kayıtla yapılır ve eskisine bağlanır                      |
| **PLAN**    | Faz görevleri, kabul ölçütleri                       | Yeniden yazılabilir. Görev kimliği sabittir; kimlik emekliye ayrılırsa nereye gittiği yazılır |
| **YAŞAYAN** | Kod indikçe güncellenen referans                     | Yerinde güncellenir; durum satırı tarih taşır                                                 |

## Ölçüm kimlikleri — kim sahibi

M-numaraları iki ayrı seri olarak ilerliyor ve çakışıyor; `M9` grep'i ikisinden de
sonuç verir. Sahibi olan kayıt dışında hiçbir belge bir M-numarasını **tanımlamaz**.

| Seri    | Ürün          | Tanımlandığı yer                                                   |
| ------- | ------------- | ------------------------------------------------------------------ |
| M1–M10  | HTTP kataloğu | [kararlar/003-istek-ustverisi.md](kararlar/003-istek-ustverisi.md) |
| M11     | XML           | [xml/xml-f1-kapanis.md](xml/xml-f1-kapanis.md)                     |
| M12–M18 | XML           | [xml/xml-f2-kapanis.md](xml/xml-f2-kapanis.md)                     |
| M19–M29 | XML           | [xml/xml-f3-kapanis.md](xml/xml-f3-kapanis.md)                     |

Aynı çakışma T-serisinde de var: [xml/test-stratejisi.md](xml/test-stratejisi.md)'nin
T01–T27'si XML kabul görevleridir, `fazlar/faz-4-hata-cache-transport/notlar.md`'nin
T10–T15'i ilgisiz bir HTTP serisidir.

## Kök

| Belge                                                            | Sınıf            | Ne için                                                                                                                      |
| ---------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [00-genel-bakis.md](00-genel-bakis.md)                           | YAŞAYAN          | Vizyon, mimari kararlar, faz tablosu. Okumaya buradan başlanır                                                               |
| [nasil-calisiyor.md](nasil-calisiyor.md)                         | YAŞAYAN          | Yetki katmanına dokunmadan taşıma; görünürlük ≠ yaptırım                                                                     |
| [paket-yerlesimi.md](paket-yerlesimi.md)                         | YAŞAYAN          | Paket ağacı ve rol ayrımı                                                                                                    |
| [gercek-backend-entegrasyonu.md](gercek-backend-entegrasyonu.md) | KANIT + rehber   | Gerçek bir backend'e kurulum; 718 endpoint / 25 controller ölçümleri                                                         |
| [sema-hatti-acik-bulgular.md](sema-hatti-acik-bulgular.md)       | KANIT (tarihsel) | Beş doğrulanmış şema bulgusu ve denetimde elenen iddialar. Güncel kural metni `packages/spec/schema-conversion-rules.md`'dir |

## kararlar/ — global ADR serisi

Kapalı ve tarihli kayıtlar. Numaralar değiştirilmez, kayıtlar geriye dönük
düzenlenmez. 015'in kuralı: **tüketiciye görünen sözleşme değişikliği ADR alır.**

| #                                                             | Konu                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| [001](kararlar/001-kimlik-tasiyicilari.md)                    | Kimlik taşıyıcıları                                            |
| [002](kararlar/002-arguman-eslemesi.md)                       | Argüman eşlemesi                                               |
| [003](kararlar/003-istek-ustverisi.md)                        | Sentetik istek üstverisi — **M1–M10 burada**                   |
| [004](kararlar/004-nestjs-dogrulamasi.md)                     | NestJS doğrulaması ve sentetik bağlam                          |
| [005](kararlar/005-excel-okuma-semantikleri.md)               | Excel okuma semantikleri (732 satır; ürün semantiği referansı) |
| [006](kararlar/006-genisletme-noktalari.md)                   | Genişletme noktaları                                           |
| [007](kararlar/007-hata-eslemesi.md)                          | Hata eşlemesi                                                  |
| [008](kararlar/008-tasima-ve-oauth.md)                        | Taşıma ve OAuth 2.1                                            |
| [009](kararlar/009-sema-donusum-ve-tani-siniflari.md)         | Şema dönüşümü ve tanı sınıfları                                |
| [010](kararlar/010-versiyonlama-politikasi.md)                | Versiyonlama politikası                                        |
| [011](kararlar/011-nestjs-gorunurluk-ve-probe.md)             | NestJS görünürlüğü ve probe                                    |
| [012](kararlar/012-tip-sekli-ve-sema-kural-katmani.md)        | Tip şekli ve şema kural katmanı                                |
| [013](kararlar/013-govde-koku-tel-bicimi.md)                  | Gövde kökü tel biçimi                                          |
| [014](kararlar/014-spec-v1-0-ve-amendment-listesi.md)         | Spec v1.0 ve amendment listesi                                 |
| [015](kararlar/015-dosya-kaynagi-cekirdegi.md)                | Dosya kaynağı çekirdeği — `file-core`'un doğuşu                |
| [016](kararlar/016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md) | İkinci dosya sunucusu ve yanıt bütçesi                         |
| [017](kararlar/017-xml-dugum-modeli-ve-yanit-sayfasi.md)      | XML düğüm modeli, cursor bağı, yanıt sayfası                   |
| [018](kararlar/018-xpath-ve-kayit-projeksiyonu.md)            | XPath sözleşmesi, kayıt projeksiyonu, sayısal politika         |
| [019](kararlar/019-buyuk-dosya-ve-kademe.md)                  | Büyük dosya, kademe ve kayıt parçalama                         |
| [020](kararlar/020-parcali-kademe-yuzeyi.md)                  | Parçalı kademenin tüketiciye görünen yüzeyi                    |

## fazlar/ — HTTP kataloğu ürün hattı

Altısı kapalı, biri açık, biri başlamadı. Her dizinde `plan.md` (PLAN) ve çoğunda
`notlar.md` (KANIT) var; kabul ölçütleri planda, deney kayıtları notlarda.

| Faz                                                              | Durum                   | Dosyalar                         |
| ---------------------------------------------------------------- | ----------------------- | -------------------------------- |
| [faz-1-walking-skeleton](fazlar/faz-1-walking-skeleton/)         | tamamlandı              | plan, notlar                     |
| [faz-2-spec-cikarma](fazlar/faz-2-spec-cikarma/)                 | tamamlandı              | plan, notlar                     |
| [faz-3-sema-ve-arama](fazlar/faz-3-sema-ve-arama/)               | tamamlandı              | plan, notlar (en büyük faz notu) |
| [faz-4-hata-cache-transport](fazlar/faz-4-hata-cache-transport/) | tamamlandı              | plan, notlar                     |
| [faz-5-csharp-alpha](fazlar/faz-5-csharp-alpha/)                 | **devam ediyor**        | plan, notlar                     |
| [faz-6-nestjs-sdk](fazlar/faz-6-nestjs-sdk/)                     | tamamlandı              | plan, notlar                     |
| [faz-7-web-ui](fazlar/faz-7-web-ui/)                             | başlamadı               | plan (placeholder)               |
| [faz-8-dosya-cekirdegi](fazlar/faz-8-dosya-cekirdegi/)           | tamamlandı (kod tarafı) | plan (ölçülen baseline dahil)    |

## xml/ — dosya sunucuları ürün hattı

Bu hattın kendi indeksi ve okuma sırası [xml/README.md](xml/README.md)'dedir; yönetim
kuralları oradadır.

| Belge                                                                            | Sınıf            | Ne için                                                                                               |
| -------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| [xml/README.md](xml/README.md)                                                   | YAŞAYAN          | Hattın indeksi, okuma sırası, faz tablosu, yönetim kuralları                                          |
| [xml/kararlar.md](xml/kararlar.md)                                               | YAŞAYAN          | XML mimari kararları K1–K10 (global ADR serisinden ayrı)                                              |
| [xml/tool-sozlesmesi.md](xml/tool-sozlesmesi.md)                                 | YAŞAYAN          | Yedi tool'un girdi/çıktı sözleşmesi                                                                   |
| [xml/test-stratejisi.md](xml/test-stratejisi.md)                                 | PLAN + KANIT     | T01–T27 matrisi, katman sahipliği, kapanış kanıtı şablonu                                             |
| [xml/excel-platform-testleri.md](xml/excel-platform-testleri.md)                 | YAŞAYAN          | Platform CI runbook'u; ölçüm taşımaz                                                                  |
| [xml/kaynaklar.md](xml/kaynaklar.md)                                             | KANIT            | Kaynak araştırma belgelerinin SHA-256'sı, taşınmayan kesinlik iddiaları                               |
| [xml/bagimlilik-karar-eki.md](xml/bagimlilik-karar-eki.md)                       | KANIT            | `libxml2-wasm@0.7.2` bütünlük, lisans, gömülü sürüm, advisory kaydı                                   |
| [xml/f0-kanit-kaydi.md](xml/f0-kanit-kaydi.md)                                   | KANIT            | F0 kapısı; DOCTYPE dedektör karışıklık matrisi, bütçe türetme tablosu, kabul edilen sekiz sınır       |
| [xml/f0/](xml/f0/)                                                               | KANIT            | Dokuz JSON probe kaydı, 200 satır ham ölçüm. Yerel yeniden üretimdir; kapının kanıtı CI artifact'ıdır |
| [xml/xml-f1-kapanis.md](xml/xml-f1-kapanis.md)                                   | KANIT            | F1 kapanışı — **M11**                                                                                 |
| [xml/xml-f2-kapanis.md](xml/xml-f2-kapanis.md)                                   | KANIT            | F2 kapanışı — **M12–M18**; residency katsayısı 8,62–10,06×                                            |
| [xml/xml-f3-kapanis.md](xml/xml-f3-kapanis.md)                                   | KANIT            | F3 kapanışı — **M19–M29**; platform tablosu kasten boş                                                |
| [xml/excel-file-core-bulgular.md](xml/excel-file-core-bulgular.md)               | KANIT            | 35 bulgunun sicili; inceleme anındaki `file:line` kanıtı                                              |
| [xml/excel-hardening-uygulama.md](xml/excel-hardening-uygulama.md)               | KANIT            | Güvenlik kapatma kaydı; yedi satırlık kaynak ölçümü; EXCEL-META-009/010/025                           |
| [xml/excel-acik-maddeler-karar-kaydi.md](xml/excel-acik-maddeler-karar-kaydi.md) | KANIT            | K26/K27/K28'in reddedilen seçenekleri; 1900/1904 oracle tablosu                                       |
| [xml/excel-ci-inceleme-2026-09-08.md](xml/excel-ci-inceleme-2026-09-08.md)       | KANIT (tarihsel) | Beş ara CI koşu kimliği ve tur başına kök neden. Güncel durum olarak okunmaz                          |

### xml/fazlar/ — F0–F6

| Faz                                                                    | Durum                                    |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| [00-kanit-ve-karar](xml/fazlar/00-kanit-ve-karar.md)                   | tamamlandı                               |
| [01-ortak-cekirdek-ve-excel](xml/fazlar/01-ortak-cekirdek-ve-excel.md) | tamamlandı                               |
| [02-okuma-mvp](xml/fazlar/02-okuma-mvp.md)                             | tamamlandı                               |
| [03-sorgu-ve-kayitlar](xml/fazlar/03-sorgu-ve-kayitlar.md)             | uygulandı, platform kanıtı bekliyor      |
| [04-buyuk-dosya](xml/fazlar/04-buyuk-dosya.md)                         | **planlandı**; L0–L8 kapıları, karar 019 |
| [05-genisletmeler](xml/fazlar/05-genisletmeler.md)                     | başlanmadı; isteğe bağlı                 |
| [06-yayin-ve-kabul](xml/fazlar/06-yayin-ve-kabul.md)                   | XML için başlanmadı                      |

## Yönetim kuralları

Hattın kendi kuralları [xml/README.md](xml/README.md)'dedir. Bütün `docs/` için geçerli
olanlar:

- **Kanıt kaydı silinmez.** Yol haritası planı geçersiz kılar, kanıtı değil. Bir
  ölçümün yanlış olduğu anlaşılırsa yeni kayıt açılır ve eskisine bağlanır.
- **Görev kimliği sabittir.** Bir kimlik emekliye ayrılırsa nereye gittiği yazılır;
  sahipsiz bulgu kaybolan bulgudur.
- **Durum yalnız kanıt bağlantısıyla `tamamlandı` yapılır.** Yerel başarı platform CI
  başarısının yerine geçmez.
- **Aynı CI kanıtı tek kaynakta durur.** Başka belge ona link verir, sayıyı tekrar
  yazmaz; tekrar edilen sayı eskir ve iki farklı gerçek üretir.
- **ADR geriye dönük düzenlenmez.** Düzeltme yeni numaralı kayıttır.
