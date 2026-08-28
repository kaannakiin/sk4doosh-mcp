# Faz 2 — Notlar

Tarih: 2026-08-28. Faz 2 çekirdeği tamam: spec v0 + ilk 6 fixture + tip üretim hattı + `@sk-mcp/*` rename.

## Alınan kararlar

- **Şema dili JSON Schema (draft 2020-12), Zod sözleşmede yok.** Zod ancak TS paketlerinin iç mutfağında kullanılabilir; dışa sızan artifact her zaman JSON Schema.
- **Nötr model = OpenAPI'nin katı alt kümesi** — [packages/spec/metadata-sozlesmesi.md](../../../packages/spec/metadata-sozlesmesi.md).
- **İsimlendirme + çakışma=hata** — [packages/spec/isimlendirme.md](../../../packages/spec/isimlendirme.md).
- **POST `destructiveHint: false`** (kullanıcı seçimi; override kaçış kapısı spec'te).
- **Auth v0 = ad + anonim biti**; Nest guard'ları için `"guard:X"` opak referansı yer tutucu.
- **Dil**: prose Türkçe, makine-okur İngilizce (kullanıcı seçimi).
- **Tip üretimi**: `json-schema-to-typescript` + tam dereference; üretilen tipler **commit edilir** (taze clone'da editör kırılmaz); turbo `gen` task'ı `$TURBO_ROOT$` inputs ile spec değişiminde invalidate olur.
- **Rename `@repo/*` → `@sk-mcp/*` yapıldı** (core, eslint-config, typescript-config + tüm iç referanslar).

## Açık soruların cevapları (plandakiler)

- Fallback isimlendirme: `{metod}_{statik parçalar}_by_{path parametreleri}`; çakışma ve desen ihlali hata.
- Auth derinliği: v0'da yalnız ad + anonim biti; derinleşme ihtiyacı Faz 3 arama filtrelemesinden gelirse eklenir.
- PATCH/PUT hint'leri: tablo [metadata-sozlesmesi.md](../../../packages/spec/metadata-sozlesmesi.md)'de; `—` = alan yazılmaz.
- Fixture girdi soyutluğu: tamamen nötr model (ApiExplorer'a benzemez); naming fixture'ları küme alır (çakışma kümenin özelliği).

## Sürprizler / teknik notlar

- `json-schema-to-typescript`, dosyalar arası `#/$defs/...` fragment'larını URI-encode edip (`%24defs`) parse edemiyor → şema kökleri doğrudan tanım yapıldı (sarmalayıcı `$ref` yok), gen script'i compile'dan önce `@apidevtools/json-schema-ref-parser` ile tam dereference ediyor. Ajv etkilenmedi ($id ile çözüyor).
- Üretilen çıktıdaki JSDoc blokları (patternProperties notları) yorum yasağı gereği script'te sıyrılıyor.
- pnpm strict: ref-parser transitive'di, açık devDep yapıldı.
- pnpm, `json-schema-to-typescript@16`'yı `minimumReleaseAgeExclude`'a ekledi (yeni yayın); bilgi amaçlı.

## Bitti kriterine karşı durum

- [x] Fixture'lar şemaları geçiyor: `pnpm validate` → 6/6.
- [x] `get-order-policy.json` beklentisi Faz 1'in gerçek `get_order` çıktısıyla tutarlı (ad, readOnly, policy).
- [x] Spec dökümanlarında ASP.NET jargonu yalnız "kaynak eşleme" parantezlerinde (bilinçli).
- [ ] Kalan: fixture'ları gerçekten koşan SDK testi — Faz 3'ün işi (bugün yalnız şema doğrulaması var).
