# Faz 4 — Hata Eşleme, Cache, Transport Sertleştirme

Durum: **tamamlandı** — bkz. [notlar.md](notlar.md).

## Hedef

SDK'yı "demo çalışıyor"dan "gerçek bir backend'e gömülebilir"e taşımak: agent'ın kendini düzeltebildiği hatalar, kimlik başına cache, dışarıdan gerçek OAuth ile bağlanılabilen transport.

## Somut çıktılar

- `error-mapping.md` finalize + `error-mapping/` fixture'ları: validation (400/ProblemDetails), 404, 403, 500 → agent'ın **eyleme dönüştürebileceği** MCP error'ları. Ölçüt: "quantity alanı pozitif olmalı" gibi, agent'ın input'unu düzeltip retry edebileceği mesajlar; iç detay/stack sızdırmadan.
- Per-caller cache: anahtar = kimlik/scope hash'i; kapsam = filtrelenmiş arama index'i ve tool tanımları. Manuel invalidation hook'u (backend "yetkiler değişti" diyebilsin).
- `listChanged` notification desteği (meta-tool listesi nadiren değişir ama spec uyumu için).
- Streamable HTTP + MCP OAuth 2.1 akışı uçtan uca: dış bir client gerçek token alıp DemoApi'ye bağlanıyor.

## Bitti kriteri

- Dış MCP client OAuth 2.1 akışını tamamlayıp ekstra tesisat olmadan tool çağırıyor.
- Bir yetki değişikliği, restart olmadan (invalidation hook'u ile) arama sonuçlarına yansıyor.
- Agent, validation hatasından yalnızca hata payload'ını okuyarak input'unu düzeltip başarılı retry yapabiliyor (example-agent-client ile otomatik senaryo).

## Bu fazda çözülecek açık sorular

- "Yetki değişti" sinyali generik olarak ne: polling yok, event altyapısı dayatılamaz → muhtemelen yalnız manuel invalidation API'si; imzası ne olmalı (kimlik bazlı mı, global mi)?
- Cache eviction politikası: TTL mi, boyut sınırı mı, ikisi mi?
- OAuth scope'ları: sk-mcp kendi scope'larını tanımlar mı, tamamen backend'in auth server'ına mı bırakır? (eğilim: tamamen delege — "biz ekstra yetki katmanı vermeyiz" ilkesiyle tutarlı)
- ProblemDetails kullanmayan backend'ler (düz 400 body) için fallback eşleme kuralı.
