# F2 — Salt okunur XML MVP

Durum: planlandı. Sorumlu: XML geliştiricisi; doğrulayan: entegrasyon/test inceleyicisi. Önkoşul: F0 geçişi ve F1-01–07'nin kullanılan yolda kapanması.

## Teslim

Dört tool: `list_documents`, `describe_document`, `read_node`, `find_in_document`. Girdi/çıktı davranışı [tool sözleşmesinde](../tool-sozlesmesi.md). İlk yayın F2 sonrasında F6 kapısından geçebilir; XPath zorunlu değildir.

| Görev | İş                                            | Somut çıktı                                                             | Kabul ölçütü                                                                                                                     |
| ----- | --------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| F2-01 | Yayınlanabilir paket ve bağlantı yüzeyi       | `packages/xml-mcp` ESM/stdio/exports/bin tasarımı ve file-core adaptörü | `core` bağımlılığı yok; publishable paket private workspace paketine bağlı değil; read-only anotasyonları doğru                  |
| F2-02 | Tek parse policy ve worker yürütücüsü         | Byte girdi, F0 limitleri, normalize hata, iptal/cleanup yolu            | Parser kullanıcının verdiği bayrakları kabul etmiyor; dış I/O yok; invalid XML başarıya dönüşmüyor                               |
| F2-03 | XML format registry ve dosya listeleme        | Allowlist + `list_documents`                                            | XML uzantılı dizin/FIFO/symlink kaçışı reddediliyor; scan bütçesi ve eksik toplam işaretli; listeleme parse yapmıyor             |
| F2-04 | Genişletilmiş ad, adres ve sıralı node modeli | XML'e özgü namespace/address katmanı                                    | Default namespace, prefix rebinding ve aynı local name/farklı URI doğru ayrışıyor; whitespace/mixed content sırası korunuyor     |
| F2-05 | Yapı keşfi                                    | `describe_document`                                                     | Root, namespace alias'ları, örnek kullanılabilir adres, yetenek/sınır ve kısmi yapı bilgisi var; sezgi şema garantisi sayılmıyor |
| F2-06 | Bütçeli düğüm okuma                           | `read_node` ve devam sözleşmesi                                         | Derinlik/node/byte sınırı birlikte uygulanıyor; cursor ilerliyor, tek büyük text açık kesiliyor, kaynak değişimi hata            |
| F2-07 | Literal arama                                 | `find_in_document`                                                      | Exact/contains, text/attribute ve scope adresi doğru; regex kabul edilmiyor; tam olmayan taramada exact total yok                |
| F2-08 | Tüm MCP yanıtlarını doğrula                   | Şema, error envelope ve payload kontrolleri                             | Hata dahil limit üstü yanıt yok; ham mutlak yol/stack yok; false/0/boş string kaybolmuyor                                        |
| F2-09 | Bağlantı testleri ve agent walkthrough        | Sentetik fixture corpus ve araç çağrısı kayıtları                       | Aşağıdaki kullanım senaryoları doğru, bounded ve dosya değiştirmeden tamamlanıyor                                                |

### F2-06 sayfa birleştirme kapısı

Tool sözleşmesindeki preorder kayıtları, `nodeId`/`parentId`/`childIndex` ilişkisiyle tekrar veya kayıp olmadan birleştirilir. Ancestor context kayıtları sayaca katılmaz. Text/element/comment/PI karışımı sayfa sınırında aynı sırada kalır. `maxDepth` nedeniyle atlanan çocuklar açıkça işaretlenir; cursor bu çocukları tamamlamayı vaat etmez. Kabul fixture'ı tek kayıtlık sayfaları, derinlik sınırını ve daha derin ayrı okuma çağrısını birlikte sınar.

## Agent kabul senaryoları

1. `pom.xml` bağımlılık sürümü: describe ile default namespace öğren, adresli okuma ile doğru bağımlılığı göster. Aynı local name başka URI'de olan tuzak alan seçilmemeli.
2. Sentetik UBL benzeri fatura: satır kimliği ve tutarı string olarak getir; baştaki sıfır ve ondalık yazımı değişmemeli. Hukuki/fatura geçerliliği sonucu verilmemeli.
3. `.csproj` ve legacy namespace'li proje: ikisinde de hedef framework alanını bul; namespace'siz varsayım legacy belgeye uygulanmamalı.
4. Mixed-content açıklama: alt elementler arasındaki text sırası ve whitespace korunmalı.
5. Hatalı veya sınır üstü belge: doğru recovery önerisi; sunucu sonraki normal çağrıda kullanılabilir kalmalı.

Her senaryo için beklenen gerçek düğüm ve içerik fixture manifestinde önceden yazılır; agent'ın makul görünen cevabı tek başına geçiş değildir. Üç tool çağrısı bir kullanılabilirlik hedefidir, zorunlu doğruluk ölçütü değildir.

## Kapsam dışı

XPath, regex, streaming, otomatik type inference, schema validation, ZIP/gzip, XML↔JSON dönüşümü, formatlama, diff, yazma ve XSLT bu fazda yoktur. Motorun desteklediği her API tool olarak açılmaz.

## Bitti ölçütü

F2-01–09 test/inceleme kanıtıyla tamamlanmış; [test matrisinin](../test-stratejisi.md) F2 zorunlu aileleri geçmiş; nihai limitler ölçülmüş; F6 kurulum/yayın kapısına hazırdır. Benchmark veya güvenlik testi “sonra” bırakılarak MVP tamamlandı denmez.
