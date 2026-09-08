# F3 — XPath ve açık kayıt analizi

Durum: planlandı. Sorumlu: XML sorgu geliştiricisi. Önkoşul: F2; worker parse/sorgu ve snapshot kapıları açık olmamalı.

## Hedef

Tekrarlanan elementlerden kontrollü bilgi çıkarma. XPath 1.0 güçlü sorgu yolu; projeksiyon ve aggregate, agent'ın her basit tablo işi için XPath yazmasını azaltır. İlk sürüm read-only'dir.

| Görev | İş                                     | Kabul ölçütü                                                                                                                                          |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| F3-01 | `select_xpath` şeması ve namespace map | Açık alias → URI, XPath 1.0 sınırı ve örnekler; ifade sessiz rewrite edilmiyor                                                                        |
| F3-02 | Motor evaluation ve typed sonuç zarfı  | Node-set/string/number/boolean ayrımı; boş node-set başarı; NaN/Infinity açık; her disposable kapanıyor                                               |
| F3-03 | Maliyet ve devam                       | Query uzunluğu, süre, sonuç byte'ı ve concurrency bütçesi; timeout gerçekten işi durduruyor; cursor başka sorgu/options ile kullanılamıyor            |
| F3-04 | Hata tanıları                          | Geçersiz prefix, unsupported XPath 3.1 ve olası default namespace tuzağı için düzeltilebilir mesaj; boş sonuç otomatik başka sorgu çalıştırmıyor      |
| F3-05 | `project_records`                      | Tekrar kümesi ve sütun adresleri açık; missing/empty/multiple ayrımı; sıralama ve pagination kararlı                                                  |
| F3-06 | `aggregate_document`                   | Önce count; numeric metrikler açık dönüşüm politikasıyla; karışık tür, büyük integer, overflow, boş küme testli; group limiti sayaç anlamını bozmuyor |
| F3-07 | Golden agent görevleri                 | JUnit failure çıkarma, pom bağımlılık projeksiyonu, sentetik fatura satır sayısı; sonuç beklenen fixture değerleriyle eşleşiyor                       |

## Özellikle yapılmayacaklar

XPath 3.1/XQuery desteği varmış gibi örnek verilmez. Namespace agnostic mod veya regex ile XPath rewrite eklenmez. Kullanıcı extension function/resolver kaydedemez. Cursor var diye motorun tüm node-set'i materialize etmediği iddia edilmez. TRX/XBRL ilişkileri generic aggregate içinde örtük join'e dönüştürülmez.

## Kanıt ve çıkış

Query testleri node-set sırasını ve scalar sonuçları denetler; yalnız snapshot text karşılaştırması yetmez. Aynı snapshot üzerinde sayfaların birleşimi tek tam sonuca eşit olmalı; byte limiti sonucu kestiğinde tanı bulunmalı. Worker termination sonrası eski cursor reddedilmeli. F3 yayınlanmadan F6, yeni tool/schema ve adversarial sorgu corpus'u ile tekrarlanır.
