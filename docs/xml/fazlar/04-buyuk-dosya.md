# F4 — Büyük dosya ve çoklu belge araması

Durum: başlanmadı; isteğe bağlı (2026-09-08). Sorumlu: XML performans geliştiricisi. Önkoşul: F3 ve DOM sınırının gerçek kullanımda yetersiz kaldığını gösteren kayıt. MVP için zorunlu değildir.

F4-01–07 açık; XML streaming parser veya indeks uygulanmadı. Mevcut file-core, sınırlı dosyayı tek byte snapshot'ı olarak okur. Artımlı dizin listelemesinin tamamlanması streaming XML okuması anlamına gelmez. F4, büyük dosya erişimini tasarlarken kök handle yetkilendirmesini, okuma sınırlarını ve kaynak değişimi kontrolünü korumalı; pathname ile güvensiz yeniden açma eklememeli.

## Hedef

DOM'a sığmayan belgeden sınırlı path/record araması yapmak. Genel XPath'i streaming'e çevirmek hedef değildir. İlk aday `sax`; gerçek paket sürümü, lisansı, namespace ve chunk davranışı bu fazda yeniden doğrulanır. [Resmi sax dokümanı](https://github.com/isaacs/sax-js).

| Görev | İş                                       | Kabul ölçütü                                                                                                                              |
| ----- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| F4-01 | Kullanım ve bütçe kararı                 | Büyük dosya örnekleri, gerekli sorgular ve target host ölçümü var; yalnız olası ihtiyaç için ikinci parser eklenmiyor                     |
| F4-02 | Streaming decoder/parser karşılaştırması | Chunk ortasında UTF-8/UTF-16 karakter, declaration, namespace, attribute ve dev text corpus'u doğru; parser token buffer'ı sınırlı        |
| F4-03 | Desteklenen selector alt kümesi          | Namespace-aware descendant record taraması açık tanımlı; geriye/global erişim isteyen sorguya unsupported; sessiz yaklaşık sonuç yok      |
| F4-04 | Tarama ve olası indeks bütçesi           | Input byte, ziyaret/node/derinlik, index entry/byte, text, süre ve çıktı ayrı sınırlı; büyük dosya boyutuyla sınırsız indeks büyümüyor    |
| F4-05 | Devam ve kaynak değişimi                 | Cursor snapshot/scan konumuna bağlı; değişen dosya/index geçersiz. Çok byte'lı metinde karakter offset'i byte offset'i diye kullanılmıyor |
| F4-06 | `search_documents`                       | Artımlı dosya keşfi + dosya başı ve toplam bütçe; unreadable/unsupported/değişen dosyalar ayrı sayaç; eksik tarama exact total değil      |
| F4-07 | DOM/streaming parity                     | Alt kümede aynı fixture için aynı genişletilmiş ad/değer/sıra; doğrudan read parser'ıyla çelişen entity/encoding davranışı yok            |

## Kesilmiş XML parçası riski

Byte-offset aralığını bağımsız parse etmek; ancestor namespace, `xml:lang`, `xml:base`, decoder state ve element sınırını kaybedebilir. Offset index sadece performans fikridir; bu bağlamları koruduğu ve aralığın gerçek byte sınırı olduğu kanıtlanmadan kullanılmaz. İndeks gerekmiyorsa sınırlı yeniden tarama ve maliyet açıklaması daha küçük ilk çözümdür.

## Kabul

10/50/100 MiB ve en az bir hedef gerçek boyut örneğinde peak RSS, scan zamanı ve index maliyeti kaydedilir; sample sayısı ve ortam belirtilir. Bunlar gelecekteki test boyutlarıdır, ölçülmüş başarı değildir. Dev tek record'un sınırı aşması açık hata vermeli; streaming etiketi limitsiz dosya desteği anlamına gelmemeli. Kullanım kazancı ve correctness kanıtı yoksa bu faz ertelenir; F2 oversized hata davranışı geçerli kalır.
