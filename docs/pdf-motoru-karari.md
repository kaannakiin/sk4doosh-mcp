# PDF motoru — pdf-inspector davranışı ve tool sözleşmesine etkisi

**Durum:** ölçüldü, uygulanıyor
**Tarih:** 22 Eylül 2026
**Kapsam:** `packages/servers/pdf-mcp` (`engine/`, `document/`, `tools/`). Diğer paketler bu kayıttan etkilenmedi.
**Ölçüm:** `@firecrawl/pdf-inspector@1.23.0`, darwin-arm64, Node 24.12. Fixture'lar elle üretilmiş PDF'ler (doğru xref tablosuyla).

## Neden ölçüldü

Kütüphanenin `index.d.ts`'i sayfa indekslemeyi alan alan belgeliyor ama bozuk ve şifreli
belge davranışını hiç belgelemiyor: `isEncrypted` alanı yok, hata tipi export edilmiyor,
`password` yalnız OCR yolunda var. Hata kodları tahminle yazılamazdı.

Ölçüm iki beklenmedik şey buldu; ikincisi `describe_document`'ın tasarımını değiştirdi.

## Bulgu 1 — aynı sayfa, iki farklı taban

Tek görüntü sayfalı belgede:

```text
classifyPdfAsync(bytes).pagesNeedingOcr        -> [0]
extractPagesMarkdownAsync(bytes).pagesNeedingOcr -> [1]
```

İkisi de aynı sayfayı gösteriyor. `.d.ts` bunu alan doc comment'lerinde söylüyor ve ölçüm
doğruladı. Aynı `pagesNeedingOcr` adı iki API'de iki farklı tabanda.

Dahası `extractPagesMarkdown`'ın **tek yanıtında** iki taban birden var:
`PageMarkdownResult.page` 0 tabanlı, kardeş `pagesNeedingOcr` dizisi 1 tabanlı.

Bu yüzden dönüşüm tek yere kilitlendi: `src/engine/`. Lint, `@firecrawl/pdf-inspector`
import'unu o klasör dışında yasaklıyor — ikinci bir import noktası bu hatayı geri getirirdi.

## Bulgu 2 — `classifyPdf.pagesNeedingOcr` bir sayfa listesi değil

Ölçüm, 10 sayfalık karma belgelerde:

| belge                         | `classify.pagesNeedingOcr` (0→1 çevrilmiş) | `extract` per-page gerçek |
| ----------------------------- | ------------------------------------------ | ------------------------- |
| 9 metin + 1 görüntü (sonda)   | `[1,2,3,4,5,6,7,8,9,10]`                   | `[10]`                    |
| 1 görüntü + 9 metin (başta)   | `[1,2,3,4,5,6,7,8,9,10]`                   | `[1]`                     |
| 5 metin / 5 görüntü dönüşümlü | `[1,2,3,4,5,6,7,8,9,10]`                   | `[2,4,6,8,10]`            |
| 10 metin                      | `[]`                                       | `[]`                      |

Üç karma vakada da `pdfType: ImageBased`, `confidence: 0.80`. Yani belgede **bir tek**
görüntü sayfası varsa classify bütün sayfaları işaretliyor: bu belge düzeyinde bir hüküm,
sayfa düzeyinde bir tespit değil.

`extract`'ın `pagesNeedingOcr` dizisi dört vakada da sayfa sayfa `needsOcr` alanıyla
birebir örtüştü.

**Sonuç: `describe_document` sayfa listesini classify'dan üretemez.** 10 sayfanın biri
taranmışken ajana "10 sayfa da OCR istiyor" demek, planın yasakladığı türden bir yanlış
bilgi. Bu yüzden `describe_document` extract varyantını yüklüyor; classify yalnız
`documentType` ve `classificationConfidence` için çağrılıyor (1 ms).

Yan etkisi tasarımı sadeleştirdi: iki cache varyantı ("classify" / "extract") tek varyanta
düştü. `describe_document` + `read_pages` sırası artık tek çıkarma maliyeti ödüyor.

`confidence` temiz metin belgesinde 0.50, karma belgede 0.80 — yani **metin doğruluğu
değil**, sınıflandırıcının kendi hükmüne güveni. Yanıt alanı bu yüzden
`classificationConfidence` adını taşıyor.

## Bulgu 3 — aralık dışı sayfa hata vermiyor, hayalet sayfa üretiyor

200 sayfalık belgede:

```text
extractPagesMarkdownAsync(bytes, [9999]) -> [{ page: 9999, markdown: "", needsOcr: true }]
extractPagesMarkdownAsync(bytes, [-1])   -> [{ page: 4294967295, markdown: "", needsOcr: true }]
```

Negatif değer u32'ye sarıyor. İkisi de hata değil: var olmayan bir sayfa, **OCR gerektiren
bir sayfa gibi** dönüyor. Kütüphaneye geçmeden önce sayfa numaraları `pageCount`'a karşı
doğrulanacak; aralık dışı istek `invalid_argument`. Aksi halde ajan olmayan bir sayfanın
taranmış olduğunu sanır.

## Bulgu 4 — hata yüzeyi: kod yok, mesaj var

Bütün başarısızlıklar `Error` olarak atılıyor, `code` her vakada `GenericFailure` (napi
generic'i), ayırt edici bilgi yalnız mesajda ve mesaj rust fonksiyon adıyla önekli:

```text
classify_pdf: Not a PDF: file is empty          <- 0 bayt
classify_pdf: Invalid PDF structure             <- truncate edilmiş, çöp bayt
classify_pdf: PDF is encrypted                  <- /Encrypt taşıyan trailer
extract_pages_markdown: PDF is encrypted        <- aynı belge, diğer API
```

Hiçbir vakada process çökmedi, hiçbiri asılı kalmadı.

Sınıflandırma mesaj içeriğine bakmak zorunda; `code` ayırt etmiyor. Eşleme:

| mesaj                                              | kod                 |
| -------------------------------------------------- | ------------------- |
| `PDF is encrypted` içeriyor                        | `encrypted_pdf`     |
| `Not a PDF` ya da `Invalid PDF structure` içeriyor | `malformed_pdf`     |
| diğer                                              | `extraction_failed` |

Fonksiyon adı öneki iç detay; ajana giden mesaj `engine/` içinde yeniden yazılıyor.

**Bu eşleme kırılgan ve bilerek öyle:** üst sürümde mesaj metni değişirse sınıflandırma
`extraction_failed`'a düşer — yanlış koda değil. Testler üç mesajı da pinliyor, böylece
sürüm yükseltmesi sessizce değil test kırarak fark edilir.

## Bulgu 5 — sayfa seçimi maliyeti orantılı düşürmüyor

200 sayfalık sentetik belge (52 KB):

```text
extract all 200   : 21.1 ms
extract pages [0] :  7.0 ms
extract pages [5,6]:  6.7 ms
classify 200      :  1.1 ms
```

Tek sayfa istemek 200'de 1 değil, 3'te 1 kazandırıyor — sabit maliyet baskın. Bu, planın
"parse'ı bölme, yanıtı sayfala" kararını doğruluyor: belge bir kez bütün çıkarılıp cache'lenir,
`read_pages` ve `find_in_document` cache üstünde çalışıp yanıtı `createPageBudget` ile sayfalar.

Sayılar sentetik ve yalnız metin taşıyan belgeden; gömülü font ve görüntü taşıyan gerçek
belgede mutlak süreler çok daha yüksek olacaktır. Ölçüm oranı gösteriyor, mutlak bütçeyi
değil — `maxExtractMs` bu yüzden ölçümden değil, güvenli üst sınırdan seçildi.

## Kapsam dışı bırakılan

OCR yolu (`processPdfWithOcr`) hiç çağrılmadı: harici PDFium ve ONNX Runtime paylaşımlı
kütüphanesi istiyor ve ilk yönlendirilen sayfada model indiriyor. v1 ağa çıkmıyor.
`OcrPdfResult`'ın beş dizisinin tabanı `.d.ts`'te belgelenmemiş; OCR açıldığında ayrıca
ölçülecek.
