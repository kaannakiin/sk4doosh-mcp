# Faz 6 — NestJS SDK (Drift Kanıtı)

> Durum 2026-08-28: request katmanı çekirdeği (dispatch, kimlik taşıyıcıları, argüman eşlemesi, üstveri, demo + MCP uçtan uca) öne çekilip yazıldı — [karar 004](../../kararlar/004-nestjs-dogrulamasi.md). Bu fazın kalanı: endpoint keşfi/metadata hasadı, `@McpTool()` decorator'ı, arama.

## Hedef

Spec'in gerçekten dil bağımsız olduğunu kanıtlamak: ikinci SDK, v1.0 spec + fixture setine karşı yazılır. Kural katı: **NestJS SDK bir fixture'ı geçemiyorsa bu Nest bug'ı değil spec bug'ı sayılır** — spec düzeltilir ve düzeltme C#'a geriye doğru uygulanır.

## Somut çıktılar

- `sdks/nestjs` (`@sk-mcp/sdk-nestjs`): route/metadata reflection ile endpoint keşfi, `@McpTool()` opt-in decorator'ı, description kaynağı olarak mevcut Nest/Swagger decorator metadata'sı.
- Dönüşüm ve arama mantığı `@sk-mcp/core`'dan **import edilir** (yeniden yazılmaz) — core'un üretim bağımlılığı olarak ilk gerçek kullanımı.
- Embedded dispatch'in Nest karşılığı: guard'lar, interceptor'lar, pipe'lar değişmeden çalışacak şekilde Nest'in kendi request lifecycle'ından geçiş.
- C# DemoApi'nin endpoint şekillerini aynalayan NestJS demo uygulaması.
- Auth-passthrough kanıtı Nest terimleriyle tekrarlanır (Faz 1'in bitti kriterinin Nest versiyonu).

## Bitti kriteri

- NestJS SDK, conformance suite'in tamamını **değişiksiz** geçiyor; ya da her sapma bir spec düzeltmesi olarak işlenmiş ve C# SDK güncellenmiş.
- İki demo uygulama, aynı arama sorgusuna ve aynı kimlik senaryolarına davranışsal olarak eş sonuç veriyor.

## Bu fazda çözülecek açık sorular

- Nest'te sentetik request/response üretiminin temiz yolu (adapter katmanı Express/Fastify farkını nasıl emer?).
- Hangi spec kuralları farkında olmadan ASP.NET aromalı kalmış? (ör. model binding varsayımları vs `class-validator` davranışı — bulunanlar spec amendment listesine)
- Nest'te caller identity'nin arama öncesi değerlendirmesi: guard'lar `ExecutionContext` ister — sentetik context mi, ayrı bir policy değerlendirme yolu mu?
