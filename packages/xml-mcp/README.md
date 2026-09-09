# @sk-mcp/xml-mcp

Yerel XML belgelerini okuyan, salt-okunur, sandbox'lanmış MCP sunucusu.
`@sk-mcp/file-core` üzerine kuruludur; `@sk-mcp/core`'a **bağımlı değildir** ve
`packages/xml-lab`'den hiçbir şey import etmez.

Kararlar [docs/xml/kararlar.md](../../docs/xml/kararlar.md), tool sözleşmesi
[docs/xml/tool-sozlesmesi.md](../../docs/xml/tool-sozlesmesi.md).

## Bu sürümde ne var

`list_documents`. `describe_document`, `read_node` ve `find_in_document`
[F2-04–09](../../docs/xml/fazlar/02-okuma-mvp.md)'dadır.

Paket ayrıca parse policy'sini ve worker yürütücüsünü içerir; `list_documents`
bunları kullanmaz ve **hiçbir dosyayı parse etmez**.

## Bağlayıcı kurallar

- **Parse worker'da olur.** Ana süreç yalnız serileştirilebilir handle taşır; WASM pointer'ı sınırı geçmez. `packages/file-core`'un doküman store'una disposal hook'u eklenmedi ve gerekmedi ([K6](../../docs/xml/kararlar.md)).
- **Worker girişi host yüzeyini import etmez.** `src/xml-worker.ts` yalnız `node:worker_threads`, `node:buffer`, `libxml2-wasm` ve type-only protokolü görür; bir lint sınırı bunu zorlar. Worker bir kod string'i döner, hata nesnesini ana taraf kurar.
- **DOCTYPE parse'tan önce reddedilir.** Prolog tarayıcısı ana süreçte çalışır; `doc.dtd` yalnız ikinci denetimdir. Ölçüldü: `XML_PARSE_NO_XXE` internal DTD subset'ini engellemiyor.
- **Worker'ın stdout'u ebeveynin fd 1'ine karışmaz.** `stdout: true` ile ayrılır; stdio MCP'de tek bir kaçak satır JSON-RPC'yi bozar.
- **`diag` production'da kapalıdır** ve env var ile açılamaz: %24,9 maliyetli ve ham raporu motor pointer'ı taşır.
- **`libxml2-wasm` exact `0.7.2`.** Caret [F0-01 bütünlük kaydını](../../docs/xml/bagimlilik-karar-eki.md) sessizce geçersiz kılar; CI tarball denetleyicisi bunu zorlar.

## Çalıştırma

```text
sk-mcp-xml <xml-source-root>
```

Kök zorunlu bir konumsal argümandır; env var yoktur. Okunabilir uzantılar:
`.xml`, `.xsd`, `.xhtml`, `.svg`, `.csproj`, `.props`, `.targets`, `.config`, `.resx`.
`.config` gibi uzantılar XML garantisi değildir; parse hatası normaldir.

## Limitler

DOM'a alınan dosya 8 MiB, iş başına 2 saniye, tek etkin worker, kuyruk 5,
yanıt zarfı 512 KiB. Türetimleri [F0 kanıt kaydında](../../docs/xml/f0-kanit-kaydi.md).
