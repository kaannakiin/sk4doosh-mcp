# Conformance Fixture Formatı

> Statü: **hipotez v0** — iki bağımsız doğrulaması (iki backend / iki framework) olmayan kural normatif değildir.

Fixture'lar [packages/conformance](../conformance) altında yaşar; her SDK'nın test paketi aynı JSON dosyalarını doğrudan okur ve geçmek zorundadır. Makine-okur şema: [schemas/fixture.schema.json](schemas/fixture.schema.json).

## Zarf

```json
{
  "kind": "naming | metadata-extraction | argument-mapping | selection | visibility | search | error-mapping",
  "description": "fixture'ın neyi sınadığı",
  "input": {},
  "expected": {}
}
```

## Türler

- `kind: "naming"` — `input.endpoints`: isimlendirmeye giren endpoint kümesi (`operationId?`, `method`, `route`). `expected` iki biçimden biri: `{"names": [...]}` (endpoints ile aynı sırada) ya da `{"error": "name_collision" | "invalid_name"}`. Küme halinde verilir çünkü çakışma tek endpoint'in değil kümenin özelliğidir.
- `kind: "metadata-extraction"` — `input`: tam `EndpointDescriptor`; `expected`: tam `ToolDefinition`.
- `kind: "argument-mapping"` — `input`: `{template, arguments}` (şablon: metod/route/parametre beyanları + body beyanı); `expected`: `{pathAndQuery, headers?, bodyJson?}` ya da `{"error": "unknown_argument" | "invalid_path_type" | "missing_path_parameter" | "header_injection" | "null_not_allowed"}`. Kurallar: [arguman-eslemesi.md](arguman-eslemesi.md).
- `kind: "error-mapping"` — `input`: bir `BackendResponseSpec` (`status`, `contentType?`, `headers?`, `body?`, `knownFields?`); `expected`: [invoke-result.schema.json](schemas/invoke-result.schema.json)'a uyan `InvokeSuccess` ya da `MappedError`. Kurallar: [hata-eslemesi.md](hata-eslemesi.md).

## Kurallar

- Dosya yerleşimi: `conformance/{kind}/{açıklayıcı-ad}.json`; bir dosya bir fixture.
- Alan adları İngilizce; `description` içerikleri serbest.
- Fixture'lar şemaya karşı doğrulanır: `pnpm validate` (kökten) ya da `pnpm --filter @sk-mcp/conformance validate`.
- Şema değişikliği fixture'ları kırıyorsa ikisi aynı değişiklikte güncellenir; fixture'lar tek başına "düzeltilmez".
