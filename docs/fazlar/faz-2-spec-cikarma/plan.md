# Faz 2 — Spec Çıkarma v0

## Hedef

Faz 1'in kanıtladığı davranışı, kapsam genişletmeden **önce**, dil bağımsız spec parçalarına ve ilk conformance fixture'larına genellemek. Bu faz atlanır ya da ertelenirse spec "C# kodunun düzyazısı"na dönüşür — NestJS ve sonrası için drift garantisi. Bilinçli olarak en ucuz faz: iki gerçek geri bildirim üreten fazın (1 ve 3) arasına sıkıştırılmış saf genelleme işi.

## Somut çıktılar

- `packages/spec/` ilk normatif dokümanlar (Türkçe):
  - `isimlendirme.md` — stabil tool adı kuralı (operationId benzeri; yoksa üretim kuralı).
  - `metadata-sozlesmesi.md` — her SDK'nın endpoint'ten çıkarmak zorunda olduğu alanlar: ad, description, input/output şema kaynağı, auth policy metadata'sının dil bağımsız temsili, HTTP metodu → `readOnlyHint`/`destructiveHint` eşlemesi.
  - `hata-eslemesi.md` — taslak (Faz 4'te finalize edilir).
- `packages/conformance/` ilk fixture'lar: `naming/` ve `metadata-extraction/` — en az 3 örnek endpoint'in JSON girdi (endpoint metadata'sı) / çıktı (beklenen tool tanımı) çiftleri.
- Fixture formatının kendisinin tanımı: `packages/spec/fixture-formati.md`.

## Bitti kriteri

- Fixture'lar, Faz 1 slice'ının elle ürettiği çıktıyla eşleşiyor (el kontrolü yeterli; otomatik koşum Faz 3'te).
- Spec dokümanları iç tutarlı ve kaçınılabilir yerde ASP.NET jargonu sızdırmıyor ("controller", "action" değil; "endpoint", "operasyon" gibi dil bağımsız kavramlar).

## Bu fazda çözülecek açık sorular

> Hepsi cevaplandı → [notlar.md](notlar.md)

- operationId/eşdeğeri tanımlanmamışsa fallback isimlendirme kuralı ne? (route + metod'dan üretim; çakışma çözümü)
- "Auth policy"nin dil bağımsız temsili ne kadar derin: sadece policy adı mı, claim gereksinimleri mi? (öneri: v0'da yalnız ad + "anonim mi" biti — derinleşme ihtiyacı Faz 3'ün arama filtrelemesinden gelirse eklenir)
- PATCH ve PUT için hint eşlemesi: ikisi de `destructiveHint: false, idempotentHint: ?` — kenar durumlar tablosu.
- Fixture JSON'unda girdi tarafı hangi soyutlukta: ASP.NET ApiExplorer çıktısına mı benzer, yoksa tamamen nötr bir "endpoint tanımı" modeli mi? (nötr model şart — Nest de aynı girdiyi üretebilmeli)
