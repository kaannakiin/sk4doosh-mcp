# F5 — Bağımsız genişletme kapıları

Durum: isteğe bağlı, planlandı. Her alt grup ayrı teslim ve bağımlılık kararıdır; hepsinin yapılması gerekmez. Sorumlu: ilgili XML özellik geliştiricisi. Genel önkoşul: F2 kaynak güvenliği ve bütçe sözleşmesi.

## F5-S — Şema özeti ve doğrulama

| Görev | Önkoşul                             | İş ve kabul ölçütü                                                                                                                                                                                                                       |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5-S1 | F2                                  | `describe_schema`: yalnız yerel XSD deklarasyonlarının özeti. Named type/ref, choice/sequence, cardinality ve döngü back-reference'ı göster; çözülemeyen referans ve eksik kapsamı işaretle. Effective schema veya valid sonucu verme.   |
| F5-S2 | F5-S1                               | Açık seçilen yerel schema için resolver tasarımı. Import/include zinciri, döngü, dosya sayısı, byte ve süre bütçesi; her kaynak sandbox'tan açılır. Document `xsi:schemaLocation` otomatik takip edilmez; genel fs provider kaydedilmez. |
| F5-S3 | F5-S2 + F0 benzeri izolasyon kapısı | `validate_document`: libxml2-wasm validator'ını seçilmiş XSD/RelaxNG corpus'u ile karşılaştır. Eksik özellik olursa `xmllint-wasm` maliyet/uyumluluk değerlendirmesi; sırf mevcut diye ikinci WASM bağımlılığı ekleme.                   |
| F5-S4 | F5-S3                               | `valid`, `invalid`, `validation_failed/unsupported` ayrımı. Şema yüklenememesi belge invalid demek değildir. Satır mevcutsa göster; güvenilir olmayan sütun uydurma.                                                                     |

DOCTYPE desteklemek veya genel resolver açmak bu fazın otomatik yan etkisi değildir. F5-S2 modelini parser global durumundan ayırmak kanıtlanamıyorsa validation ayrı worker/süreçte kalır veya ertelenir. XSD doğrulaması hukuki belge geçerliliği, Schematron uyumu veya XML imza doğrulaması değildir.

## F5-C — Sıkıştırılmış kaynaklar

| Görev | Önkoşul                                 | İş ve kabul ölçütü                                                                                                                                                                |
| ----- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5-C1 | F2                                      | Gzip `.xml.gz`/`.svgz` adaylığı: sıkıştırılmış byte, açılmış byte, oran ve süre sınırı; son suffix'e bakan registry için açık tasarım. Bomblar buffer tamamen ayrılmadan durmalı. |
| F5-C2 | F5-C1 veya eşdeğer decompression kapısı | ZIP giriş listeleme ve `read_xml_part`; entry count, isim, traversal, duplicate entry, symlink/encryption ve boyut politikası testli. Diske extract gerekmez.                     |
| F5-C3 | F5-C2                                   | XML parçası aynı parse policy'den geçer. `.xlsx` sheet yorumlaması Excel tool'larına yönlendirilir; `_rels`/EPUB spine otomatik takip edilmez.                                    |

`yauzl` yalnız geçmiş araştırmanın aday önerisidir; bu devirde bağımlılık olarak seçilmedi. Arşiv doğruluğu ve güncel güvenlik incelemesi bu fazın kapısıdır. Arşiv içindeki path gerçek host dosya yolu olarak açılmaz.

## F5-D — Görünüm, dönüşüm ve karşılaştırma

| Görev | Önkoşul | İş ve kabul ölçütü                                                                                                                                                                                                                 |
| ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5-D1 | F2      | `format_document` yalnız çıktı üretir. Mixed content/`xml:space` anlamını değiştirmeyen kapsam veya açık unsupported; kaynak byte fidelity vaadi yok.                                                                              |
| F5-D2 | F2      | XML → JSON dönüşümü önce bir fidelity sözleşmesi alır: attribute, namespace, order, comment/PI, boş/eksik, cardinality kaybı açık. Lossy mod uyarısız çalışmaz.                                                                    |
| F5-D3 | F5-D2   | JSON → XML için ayrı girdi şekli, ad doğrulama ve çoklu root politikası gerekir. Arbitrary JSON'un tek doğru XML karşılığı varmış gibi sunulmaz; dosya yazılmaz.                                                                   |
| F5-D4 | F3      | `diff_xml_structural`: genişletilmiş ad ve açık kardeş eşleme politikası; whitespace/comments seçeneği sonucu etkiler. Baştan eklenen kardeşin zincirleme fark üretme sınırı açıklanır; move detection/imza eşitliği vaat edilmez. |

Pretty printer'ın küçük bağımlılık olması anlam koruduğunu göstermez. Kütüphane seçimi ilgili task'a özel golden corpus ile yapılır; F2'ye ikinci parser sızdırılmaz.

## Bu planın dışında kalanlar

Write tool'ları, XSLT yürütme, XML-DSIG/C14N imza işi, genel HTML, otomatik ağdan şema indirme ve tam domain adaptörleri için ayrı gereksinim gerekir. Yazma yeniden gündeme gelirse dry-run, hedef kimliği, yarış, atomik replace, izin/metadata, encoding ve byte fidelity ayrı bir tasarım ister; readOnlyHint tipini gevşetmek tek başına yazma desteği değildir.
