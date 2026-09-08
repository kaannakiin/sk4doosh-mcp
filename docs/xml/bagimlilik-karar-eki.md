# Bağımlılık karar eki — libxml2-wasm

Durum: F0-01 tamamlandı (2026-09-08). Kaynak taban `976c6c4`. Bu ek [K1](kararlar.md) kararının sürüm, bütünlük ve lisans kaydıdır; motor sürümü her yükseldiğinde yeniden yazılır. Makine okunur karşılığı [f0/f0-01-surface.json](f0/f0-01-surface.json).

Bu ek yalnız **dağıtılan artifact** hakkındadır. Kaynak okumasından gelen iddialar burada kanıt sayılmaz; her satırın kanıt türü belirtilmiştir.

## Sabitleme

| Alan               | Değer                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Specifier          | `0.7.2` — **exact**, caret yok                                                                    |
| Bildirildiği yer   | `packages/xml-lab/package.json` `devDependencies`                                                 |
| Çözülen sürüm      | `0.7.2`                                                                                           |
| Lockfile integrity | `sha512-Ek8Fdb8fIl6mBCvrMGImkOP02aDpANwus0PV827v4gobV9jnoYEHNoPTwWokt71egUBl+sng53fjZ5y2PexLqQ==` |
| Registry integrity | Aynı değer; lockfile ile registry metadata'sı birebir eşleşiyor                                   |
| Registry shasum    | `d4884e107385a738568cc82902921b78e45a4c1e`                                                        |
| Tarball sha256     | `64f668e9afd507692c441dc3e9607feb30a954409aaa087ce822cf53f3d708b8`                                |
| fileCount          | 48                                                                                                |
| unpackedSize       | 1.228.585 byte                                                                                    |
| Yayın zamanı       | 2026-09-07T01:02:02.232Z                                                                          |
| npm `engines.node` | `>=18` (bu projenin hedefi ayrıca 22/24)                                                          |

K1 gereği caret kullanılmadı: `^0.7.2` bir sonraki `pnpm install`'da yukarıdaki bütünlük olgularının hepsini sessizce geçersiz kılardı.

### Release-age politikası

`0.7.2` sabitleme tarihinden **bir gün önce** yayınlandı. `pnpm config get minimumReleaseAge` `undefined` döndürüyor ve `pnpm install` bloke etmedi; kurulum `Lockfile passes supply-chain policies` satırıyla geçti. Bu nedenle `pnpm-workspace.yaml` `minimumReleaseAgeExclude` listesine giriş **eklenmedi**. Politika ileride etkinleştirilirse bu sürüm pencerenin içinde kalacağı için giriş gerekebilir; o durumda ek yeniden düzenlenir.

`allowBuilds` listesine de giriş eklenmedi: paket WASM dağıttığı için native build adımı gerektirmemesi bekleniyor ve bu F0-02'de ayrıca kanıtlanacak. Build script'i önden yetkilendirilmedi.

## Artifact ile incelenen revision ilişkisi

[kaynaklar.md](kaynaklar.md) bu soruyu açık bırakmıştı: _"Bu repository revision'ı ile npm artifact'ın birebir aynı olduğu ayrıca kanıtlanmadı; F0 paket kapısı bunu ele alır."_

**Sonuç: artifact incelenen revision'dan üretilmemiştir.**

| Alan                     | Değer                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| İncelenen revision       | `394487987eece208b5d02274fedc6c292f84ee6b` — `master`, `package.json` `0.8.0-dev`                                                         |
| Artifact'ı üreten commit | `6e4dc82a323b6d27f2b3aca6dbec868949be83b7`                                                                                                |
| Dal                      | `refs/heads/releases/v0.7`                                                                                                                |
| Workflow                 | `.github/workflows/release.yml`                                                                                                           |
| Attestation türü         | SLSA provenance v1 + npm publish attestation v0.1                                                                                         |
| Subject digest           | `sha512:124f0575bf1f225ea6042beb30622690e3f4d9a0e900dc2eb343d5f36eefe20a1b57d8e7a181073683d3c16a24b7bd5e814065fac9e0e777e3679cb63dec4ba9` |
| Doğrulama                | `npm audit signatures`: `1 package has a verified registry signature`, `1 package has a verified attestation`                             |

Kanıt türü: **kriptografik**. Provenance attestation tarball'ı repo + commit + workflow üçlüsüne bağlıyor ve imza doğrulandı. Yayıncı beyanı (`gitHead`) değil, doğrulanmış zincir.

Sonuç olarak önceki devirdeki kaynak okuması (`3944879`, `0.8.0-dev`) **dağıtılan `0.7.2` hakkında kanıt değildir**. Kaynak okumasından gelen her API olgusu bu yüzden kurulu artifact üzerinde ayrıca ölçüldü; sonuçlar [f0/f0-01-surface.json](f0/f0-01-surface.json) içindeki 49 satırdadır. Ölçüm, kaynak okumasındaki `ParseOption` değerlerinin, `diag` yüzeyinin, `dispose` sözleşmesinin ve fs sağlayıcılarının ayrı modülde olmasının artifact'ta da geçerli olduğunu doğruladı; `warnings` alanının prototype'ta değil instance üzerinde durması ölçümle düzeltilen tek okuma farkıdır.

## Lisans

| Katman         | Kaynak                        | Değer                            |
| -------------- | ----------------------------- | -------------------------------- |
| Wrapper        | `package.json` `license`      | MIT                              |
| Wrapper        | Tarball içi `LICENSE`         | MIT, James Lan, 2023             |
| Gömülü libxml2 | Tarball içi `LICENSE.libxml2` | libxml2 lisansı, Daniel Veillard |

Paketin kendi `LICENSE` dosyası kapsamını açıkça daraltıyor: _"This license applies to the libxml2-wasm wrapper code only."_ Gömülü kütüphane ayrı `LICENSE.libxml2` dosyasıyla dağıtılıyor. [kaynaklar.md](kaynaklar.md)'nin _"Wrapper npm lisansı ile gömülü libxml2 dağıtım lisansını tek metadata alanından eşitlemeyiz"_ kuralı bu nedenle artifact tarafından da destekleniyor; iki lisans ayrı kaydedildi.

## Gömülü libxml2 sürümü

| Basamak          | Sonuç                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `runtime-export` | **Yok.** Paket sürüm döndüren bir export sunmuyor; ham modülün 90 export'unda sürüm alanı bulunmadı                           |
| `wasm-data-scan` | **Boş.** Gömülü WASM (843.074 byte, `\0asm` magic) string tablosunda sürüm taşımıyor; libxml2 `--without-debug` ile derlenmiş |
| `upstream-pin`   | **2.15.1**                                                                                                                    |

Belirlenen sürüm: **libxml2 2.15.1**, yalnız `upstream-pin` ile.

| Alan               | Değer                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Submodule deposu   | `https://github.com/jameslan/libxml2.git` — **upstream GNOME değil, fork**                                                             |
| Submodule commit   | `f52e859efe97cf3f0b78d731976402748878529a`                                                                                             |
| Commit tarihi      | 2026-03-04                                                                                                                             |
| Commit başlığı     | `Add runtime switch of windows-styled path processing`                                                                                 |
| `VERSION` dosyası  | `2.15.1`                                                                                                                               |
| Derleme bayrakları | `--without-sax1 --without-modules --without-html --without-threads --without-catalog --without-debug --disable-shared --enable-static` |

### Kalan sınırlar

- `upstream-pin` **en zayıf basamaktır**: kaynağı tarif eder, dağıtılan artifact'i değil. Provenance attestation wrapper commit'ini bağlıyor, ancak submodule pointer'ının o commit'te bu değeri taşıdığı ayrı bir gözlemdir; WASM byte'larının bu kaynaktan üretildiği bağımsız olarak yeniden derlenerek kanıtlanmadı.
- Gömülü kaynak **fork'tur ve üstünde yerel yama vardır**. `2.15.1` upstream sürüm numarasıdır; fork'un o numaraya eklediği değişiklikler upstream advisory'lerinde görünmez. CVE takibi `2.15.1` üzerinden yapılır, fork farkı ayrıca izlenir.
- libxml2 2.15 nanohttp'yi kaldırdı. Bu derlemede `--without-catalog` da verilmiş. Dolayısıyla `XML_PARSE_NONET` **no-op olabilir** ve F0-05'teki ağ canary'sinin sıfır hit'i aşırı-belirlenmiş bir sonuçtur. Bu, ek güvence sayılmaz; F0-05 kaydına aynen taşınır.

## Advisory kapsamı

| Alan                      | Değer                           |
| ------------------------- | ------------------------------- |
| Komut                     | `pnpm audit --json`             |
| Workspace toplamı         | 8 advisory (5 moderate, 3 high) |
| `libxml2-wasm` ile ilgili | **0**                           |

**Bu boş sonuç yalnız npm paketi `libxml2-wasm` kapsamındadır. Gömülü libxml2 2.15.1 C kütüphanesi hakkında hiçbir şey söylemez.** C kütüphanesinin güvenlik durumu yukarıdaki sürüm ve fork bilgisi üzerinden upstream'de ayrıca izlenir. Advisory yokluğu güvenlik kanıtı değildir.

## Dağıtım şekli

| Gözlem                          | Değer                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| Bağımsız `.wasm` dosyası        | **Yok** — 48 dosyanın hiçbiri `.wasm` değil                            |
| WASM taşıyıcısı                 | `lib/libxml2raw.mjs` içinde ham escape'li ikili string (`SINGLE_FILE`) |
| `fetch(`                        | 0 kez                                                                  |
| `readFileSync`                  | 0 kez                                                                  |
| `instantiateStreaming`          | 0 kez                                                                  |
| `locateFile` / `wasmBinaryFile` | 0 kez                                                                  |
| Runtime bağımlılığı             | Yok                                                                    |

Glue kodunda ağ veya dosya sistemi üzerinden WASM yükleme yolu bulunmuyor. Bu, F0-02'nin _"pack içindeki WASM yükleniyor"_ ölçütü için erken kanıttır; izole tüketici ortamındaki asıl doğrulama F0-02'ye aittir.

## Karar

`libxml2-wasm@0.7.2` F0 deneyleri için sabitlendi. F0-01 kapısı geçti: dağıtılan artifact sürümü, bütünlüğü, üretildiği commit ve iki ayrı lisans katmanı belirli; gömülü C kütüphanesi sürümü belirlendi ve advisory kapsamı sınırıyla birlikte kaydedildi.

Bu, **üretim kabulü değildir**. K1'in üretimde benimsenmesi F0-02–09 sonuçlarına bağlıdır.
