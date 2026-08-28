# Hata Eşlemesi (Taslak — Faz 4'te finalize)

Hedef cümle: backend'in HTTP hataları, agent'ın **yalnızca hata payload'ını okuyarak** input'unu düzeltip retry edebileceği MCP hatalarına çevrilir; iç detay (stack, bağlantı dizesi, iç yol) sızdırılmaz.

Kapsanacaklar (Faz 4):

- 400 / validation (ProblemDetails `errors` sözlüğü) → alan bazında eyleme dönüştürülebilir mesajlar.
- ProblemDetails kullanmayan düz 400 gövdesi için fallback kuralı.
- 401 / 403 ayrımı: kimlik yok vs yetki yok — agent'a farklı yönerge.
- 404: kaynak mı yok, route mu yanlış — ayırt edilebildiği kadarı.
- 5xx: retry önerisi verilebilirlik; gövde sızdırmama.
- `error-mapping/` fixture'larının formatı.
