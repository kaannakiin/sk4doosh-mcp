# @sk-mcp/xml-lab

F0 kanıt harness'ı. [Faz tanımı](../../docs/xml/fazlar/00-kanit-ve-karar.md), [kararlar](../../docs/xml/kararlar.md).

Bu paket **ürün kodu değildir**. `libxml2-wasm` tercihini hedef dağıtımda ölçen deneyleri, fixture üreteçlerini ve kanıt toplayıcısını tutar. Çıktısı `docs/xml/f0/*.json` ve Türkçe kapanış kaydıdır.

## Neden kalıcı

Çıkış kapısı: _"Başarısız tercih değişikliği aynı fixture matrisiyle sınanır."_ Motor reddedilirse `@xmldom/xmldom` + `xpath` aynı korpustan geçmek zorunda. Fixture üreteci, manifest ve assertion'lar bu yüzden motordan bağımsızdır; yalnız `src/engine-adapter.mts` `libxml2-wasm`'e özgüdür.

## Asla olmayacakları

- `build` script'i yok, dolayısıyla `dist/` yok. Paket import edilemez.
- `main`/`types`/`exports`/`files`/`bin`/`publishConfig` yok. `private: true`.
- Hiçbir paketin `dependencies`/`devDependencies`/`peerDependencies` listesine girmez. `packages/xml-mcp` oluştuğunda buradan hiçbir şey import etmez.
- `pack` job'unun filter listesine eklenmez.
- Ürün kodu tutmaz: MCP sunucusu, tool handler'ı, `file-core` entegrasyonu, cursor codec'i burada olmaz.
- `libxml2-wasm` yalnız `devDependencies`'te ve **exact** sürümle durur; caret F0-01 integrity olgularını sessizce geçersizleştirir.
- Testler repo çalışma ağacına yazmaz. Probe stdout'a, toplayıcı `docs/xml/f0/` altına yazar.

## Deney modeli

Her deney üç katman: `test/*.spec.ts` (`spawnSync`, heap cap, timeout) → `test/probes/*.mjs` (kendi kendini assert eder, ölçer) → **stdout'a tam olarak bir JSON satırı**. Tehlikeli fixture'lar normal runner sürecinde sınırsız koşmaz.

`--max-old-space-size` yalnız JS heap'ini bağlar; WASM linear memory'yi bağlamaz. Tek RSS kanıtı ölçülmüş RSS'tir.

## Komutlar

```text
pnpm turbo run check-types lint --filter=@sk-mcp/xml-lab
pnpm turbo run test --filter=@sk-mcp/xml-lab --force
node packages/xml-lab/collect-evidence.mjs
```

`SKMCP_XML_BENCH=1` tam ölçüm kademesini açar; varsayılan yalnız 1 MiB kademesi koşar. `SKMCP_XML_F0_NO_NETWORK=1` F0-02'yi atlar ve kanıtta `not run` olarak işaretler.
