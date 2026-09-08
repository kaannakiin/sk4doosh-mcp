# F6 — Yayın ve agent kabulü

Durum: planlandı. Sorumlu: paket/yayın geliştiricisi ve doğrulayıcı. İlk yayın önkoşulu F2; sonraki özellik yayını ilgili F3/F4/F5 görevinin kapanışıdır. Bu devir çalışması yayın yapmaz.

| Görev | İş                            | Kabul ölçütü                                                                                                                                                          |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F6-01 | Paket artifact denetimi       | npm pack içeriğinde CLI, types, JS, gerekli WASM ve lisanslar mevcut; private workspace/runtime veya monorepo mutlak yolu yok                                         |
| F6-02 | Temiz tüketici kurulumu       | Paket repo dışından Node 22/24 ve desteklenecek macOS/Linux/Windows ortamında kurulur; npx/stdio başlangıcı çalışır. Destek iddiası yalnız test edilen platformlarda. |
| F6-03 | Turbo/CI bağlantısı           | Yeni paketin test/type/lint/build işleri mevcut CI filtresinde gerçekten çalışır; bağımlılık build'i atlanmaz; Excel/file-core regresyonu yeşil                       |
| F6-04 | Gerçek MCP istemcisi          | tools/list, tools/call, unknown arg, invalid schema, error, cancellation ve shutdown protokol testi; stdout kirlenmez                                                 |
| F6-05 | Agent görev değerlendirmesi   | Test planındaki golden senaryolar; doğru adres/değer, tool sayısı, çıktı byte'ı, recovery başarısı kaydedilir; yanlış URI cevabı sıfır tolerans                       |
| F6-06 | Güvenlik ve kaynak regresyonu | Parser policy, dış I/O canary, bounded yanıt, timeout sonrası sağlık, cache disposal geçer; kesin RSS garantisi olmayan yerde böyle bir vaat yok                      |
| F6-07 | Kullanıcı dokümanı            | Kurulum/root/uzantılar, encoding, DOCTYPE, limitler, XPath sürümü, cursor ömrü ve read-only kapsamı doğru; kaynak içeriği talimat olarak çalıştırılmaz                |
| F6-08 | Sürüm ve karar kaydı          | Bağımsız file-core/xml-mcp sürüm etkisi, pin/advisory/embedded libxml2 kaydı ve kapanan görev kanıtları tamam; otomatik file-core 1.0 yükseltmesi yok                 |

## Çıkış

Sonuç kaydı; commit, paket tarball hash'i, ortam matrisi, koşan komutlar, test sonuçları, ölçülen limitler ve kalan kapsam sınırını içerir. Uygulama sırasında `pnpm turbo run test --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp --filter=@sk-mcp/xml-mcp` ilgili tüketicileri sınar; repo genel lint/type/build kapıları da değişikliğe uygun çalışır. Bu komutlar bu dokümantasyon turunda çalıştırılmış değildir.

İlk yayın için F4/F5 şart koşulmaz. Geçmeyen isteğe bağlı özellik tool listesine eklenmez; başarısız özellik gizlenerek destekleniyormuş gibi duyurulmaz. Yayın işlemi ayrı uygulama tesliminin parçasıdır.
