# Faz 6 — NestJS SDK (Drift Kanıtı)

> Durum 2026-09-07: **tamamlandı** — [notlar.md](notlar.md). Request katmanı çekirdeği 2026-08-28'de
> öne çekilmişti ([karar 004](../../kararlar/004-nestjs-dogrulamasi.md)); bu fazda keşif, seçim,
> isimlendirme, katalog, şema bağlaması, arama, görünürlük (T0/T1/T2) ve üç meta-tool eklendi.
> Korpus 103 → 140 fixture, 7 → 9 tür; spec `1.0.0`
> ([karar 014](../../kararlar/014-spec-v1-0-ve-amendment-listesi.md)).

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
