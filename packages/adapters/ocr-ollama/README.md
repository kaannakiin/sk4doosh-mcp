# @sk-mcp/ocr-ollama

`@sk-mcp/pdf-mcp`'nin `OcrProvider` portunun Ollama uygulaması: sayfa görüntüsünü bir vision
modeline yollar, metni geri döner. Çalışma zamanı bağımlılığı yok — yalnız `fetch`.

```ts
import { createOllamaOcrProvider } from "@sk-mcp/ocr-ollama";

const provider = createOllamaOcrProvider({
  baseUrl: "http://127.0.0.1:11434",
  model: "deepseek-ocr:3b",
});
```

## Bağlayıcı kurallar

- **Prompt ölçülerek seçildi.** `deepseek-ocr` çıplak bir yönergeye ve özellikle
  `<image>\n<|grounding|>...` biçimine `text[[60, 209, 789, 699]]` gibi sınırlayıcı kutuları metnin
  içine karıştırarak cevap veriyor. `<image>\nFree OCR.` sayfanın metnini ve başka hiçbir şeyi
  döndürdü. Başka bir modele geçerken kendi promptunu ölç.

- **Sayfa başına tek istek.** Vision modeli görüntünün tamamını bağlamında tutar ve Ollama zaten
  model başına istekleri sıraya sokar; toplu göndermek hiçbir şey kazandırmaz, bir yavaş sayfanın
  diğerlerinin sonucunu geciktirmesine yol açar.

- **200 yanıtı başarı demek değil.** Ollama, model bulunamadığında 200 ile `error` alanı döndürüyor;
  yalnız statüye bakan bir okuyucu o hata metnini sayfanın metni sanardı. Her sonuç ayrık bir birleşim
  olarak adlandırılır: `text`, `refused`, `unreadable`.

- **Boş transkript olduğu gibi geçer.** Bunu bir cevap saymama kararı `pdf-mcp`'ye aittir; orada sayfa
  `needsOcr` işaretli kalır.

- **`temperature: 0`** — aynı sayfa aynı metni versin.

Port tipleri buraya yapısal olarak kopyalanmıştır (paket hiçbir `@sk-mcp/*` paketi adlandırmaz,
grafik döngüsüz kalır). Kopyanın sapmadığını `pdf-mcp/test/adapters.spec.ts` derleme zamanında
pinler.
