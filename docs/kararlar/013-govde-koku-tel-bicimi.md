# Karar 013 — Gövde Kökü Tel Biçimi

Tarih: 2026-09-07. Durum: **kabul edildi, kodla kanıtlandı** — 5 yeni `argument-mapping` + 1
`metadata-extraction` fixture'ı iki SDK'da geçiyor; `SchemaHostTests.J17` tersine çevrildi.

## Kapatılan boşluk

[Karar 009](009-sema-donusum-ve-tani-siniflari.md) `[FromBody] List<int>` gibi nesne olmayan gövde
köklerini kapsam dışı bırakmış ve ara çözüm olarak endpoint'i `non_object_body` ile düşürmüştü.
Gerekçe doğruydu: o endpoint'ler zaten **tamamen ölüydü** (gövde hiç gönderilmiyor, izin listesi boş
kaldığı için her argüman reddediliyor), dolayısıyla düşürmek katı iyileşmeydi. Ama karar aynı
zamanda doğru uzun vadeli çözümü de adlandırmıştı: sentetik tek argüman.

## Karar: sentetik `body` argümanı

Nesne olmayan bir gövde kökü artık endpoint'i düşürmez:

```json
{
  "type": "object",
  "properties": { "body": { "type": "array", "items": { "type": "integer" } } },
  "required": ["body"],
  "additionalProperties": false
}
```

Çağrı anında `body` argümanının değeri **gövdenin tamamı** olarak gönderilir. Argüman gelmezse
gövde hiç gönderilmez ve kararı backend'in model binder'ı verir — `absent-query-omitted` ile aynı
disiplin.

**Ad beyan edilmez, türetilir.** `!isObjectSchema(requestBody.schema)` yüklemi hem `inputSchema`'yı
hem composer'ın ikinci gövde modunu tetikler. Bu, `inputSchema.additionalProperties`'in
türetilmesiyle aynı disiplindir (karar 009): tek yüklem iki tarafı besler, ayrışamazlar.

Ad, parametre adlarına karşı mevcut `assertUniqueArgumentNames` denetiminden geçer: `body` adlı bir
parametre varsa `argument_collision` üretilir ve endpoint düşer. Şablon aynı anda hem gövde kökü hem
gövde alanı bildiremez — yeni template hata kodu `conflicting_body_modes`.

## `non_object_body` emekliye ayrıldı

Kod `DiagnosticCodes`'tan silindi ve **yeniden kullanılmayacak**: eski anlamı "bu endpoint hiç
çağrılamaz"dı ve artık çağrılabilir. Yerine `synthetic_body_argument` (uyarı) geldi — operatör MCP
argüman şeklinin HTTP şeklinden farklı olduğunu görebilsin.

## TS tipi bir yalan olacaktı

`ComposedRequest.bodyJson` `Record<string, unknown>` idi. C# tarafında karşılığı zaten `byte[]?`
olduğu için değişiklik gerekmiyordu; bu asimetri sessiz hata vektörüdür: JavaScript bir diziyi
`Record<string, unknown>`'a çalışma zamanında sorunsuz atar ve `toEqual` geçer, yani tip derleme
hatası değil **yalan** olurdu. Bilinçli olarak `BodyValue` union'ına genişletildi.

## Reddedilen alternatifler

- **Düşürmeyi normatif pinlemek.** Alanı "tanımsız"dan çıkarırdı ama yeteneği geri getirmezdi.
  Karar 009 düşürmeyi açıkça _ara_ çözüm olarak adlandırmıştı; kalıcılaştırmak o cümleyi
  yalanlardı.
- **Argüman adını host'a beyan ettirmek** (`[McpTool(BodyArgument = "payload")]`). Bir düğme daha,
  test çarpanı daha, ve iki SDK'nın ayrışabileceği bir yer daha — karar 003 cetveline göre tek
  doğru cevabı olan bir soruda knob açmak yanlış. Ad çakışırsa çözüm zaten mevcuttur: parametreyi
  yeniden adlandırmak.
- **Gövde kökünü `additionalProperties: true` ile serbest bırakmak.** Şemayı yalancı yapardı: bir
  dizi gövdesi ek anahtar kabul etmez, tek bir değer kabul eder.
