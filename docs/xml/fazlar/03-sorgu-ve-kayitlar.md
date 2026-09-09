# F3 — XPath ve açık kayıt analizi

Durum: **uygulandı, platform kanıtı bekliyor** (2026-09-09). Sorumlu: XML sorgu geliştiricisi. Önkoşul: F2'nin tamamlanması; XML worker parse/sorgu ve snapshot kapıları geçti.

F3-01–07 uygulandı ve yerel dört-filtre koşusu yeşil (712 test); ölçümler ve görev bazında kanıt [F3 kapanış kaydındadır](../xml-f3-kapanis.md). Durum yalnızca platform CI koşusunun bağlantısıyla `tamamlandı` yapılır; yerel geçiş kapı değildir. Kararlar [karar 018](../../kararlar/018-xpath-ve-kayit-projeksiyonu.md)'dedir ve bu belgenin iki varsayımını (cursor–restart bağı, desteklenmeyen ifadenin ne zaman reddedileceği) ölçümle düzeltir.

## Hedef

Tekrarlanan elementlerden kontrollü bilgi çıkarma. XPath 1.0 güçlü sorgu yolu; projeksiyon ve aggregate, agent'ın her basit tablo işi için XPath yazmasını azaltır. İlk sürüm read-only'dir.

| Görev | İş                                     | Kabul ölçütü                                                                                                                                               |
| ----- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F3-01 | `select_xpath` şeması ve namespace map | **Uygulandı.** Açık alias → URI, XPath 1.0 sınırı ve örnekler; ifade sessiz rewrite edilmiyor                                                              |
| F3-02 | Motor evaluation ve typed sonuç zarfı  | **Uygulandı.** Node-set/string/number/boolean ayrımı; boş node-set başarı; NaN/Infinity açık; her disposable kapanıyor                                     |
| F3-03 | Maliyet ve devam                       | **Uygulandı.** Query uzunluğu, süre, sonuç byte'ı ve concurrency bütçesi; timeout gerçekten işi durduruyor; cursor başka sorgu/options ile kullanılamıyor  |
| F3-04 | Hata tanıları                          | **Uygulandı.** Geçersiz prefix, unsupported XPath 2.0+ ve default namespace tuzağı için düzeltilebilir mesaj; boş sonuç otomatik başka sorgu çalıştırmıyor |
| F3-05 | `project_records`                      | **Uygulandı.** Tekrar kümesi ve sütun adresleri açık; missing/empty/multiple ayrımı; sıralama ve pagination kararlı                                        |
| F3-06 | `aggregate_document`                   | **Uygulandı.** Önce count; numeric metrikler açık dönüşüm politikasıyla; karışık tür, büyük integer, boş küme testli; group limiti sayaç anlamını bozmuyor |
| F3-07 | Golden agent görevleri                 | **Uygulandı.** JUnit failure çıkarma, pom bağımlılık projeksiyonu, fatura satır sayısı; sonuç beklenen fixture değerleriyle eşleşiyor                      |

## Özellikle yapılmayacaklar

XPath 3.1/XQuery desteği varmış gibi örnek verilmez. Namespace agnostic mod veya regex ile XPath rewrite eklenmez. Kullanıcı extension function/resolver kaydedemez. Cursor var diye motorun tüm node-set'i materialize etmediği iddia edilmez. TRX/XBRL ilişkileri generic aggregate içinde örtük join'e dönüştürülmez.

## Kanıt ve çıkış

Query testleri node-set sırasını ve scalar sonuçları denetler; yalnız snapshot text karşılaştırması yetmez. Aynı snapshot üzerinde sayfaların birleşimi tek tam sonuca eşit olmalı; byte limiti sonucu kestiğinde tanı bulunmalı. F3 yayınlanmadan F6, yeni tool/schema ve adversarial sorgu corpus'u ile tekrarlanır.

Bu belgenin ilk sürümündeki "worker termination sonrası eski cursor reddedilmeli" cümlesi karar 017/K17-2 ile çelişiyordu ve karar 018/K18-3 ile düzeltildi: cursor `stamp`'e bağlıdır, restart bir okumayı kaybettirmez, bir re-parse'a mal olur. Ölçüm F3 kapanış kaydındaki M24'tür.

## Kalan iş

Platform CI ve XML F0 koşusu alınmadı; bu fazın açık tek işi budur. Kalan sınırlar ve sahipleri [F3 kapanış kaydındadır](../xml-f3-kapanis.md).
