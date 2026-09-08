# Merge sonrası Excel/file-core CI incelemesi

**Güncel sonuç: başarılı.** `a033103bc802b098b3cfe03e5e3aa808a35f4808` için [CI #34224085196](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34224085196) 13/13 job ile geçti. Beş native hedef × Node 22/24, genel Node/.NET ve birleşik paket doğrulaması tamamlandı. [npm-tarballs artifact](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34224085196/artifacts/10055082654) üretildi. Aşağıdaki ilk çalışma hataları tarihsel teşhis kaydıdır; güncel durum olarak okunmamalı.

İncelenen commit: `4f2f595a0ffa411a6c9324607c4a0da097446993` (PR #1 merge).
Çalışma: [CI #34221182771](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34221182771), `main` push, 2026-09-08 14:31:56 Türkiye saati.

Nihai sonuç: **failure**. 5 iş başarılı, 7 iş başarısız, paket toplama işi atlandı.

## Kesinleşen engeller

### 1. Linux native derlemesi — P1

Linux x64/arm64 × Node 22/24 işlerinin dördü testlere ulaşmadan başarısız oldu. Genel `build, lint, types, fixtures` işi de aynı hatada durdu.

Kanıt: [Linux x64 / Node 24 logu](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34221182771/job/102044415736).

`packages/file-core-native/src/secure.cc:192–193` içindeki Windows yol önekleri `??/` dizisi içeriyor. GCC, Windows koşullu derleme bloğunda olsa bile bu kaynak dizisini `trigraph ??/ ignored` uyarısı olarak raporluyor. Build'in `-Werror` seçeneği uyarıyı derleme hatasına çeviriyor.

Düzeltme yönü: runtime yol değerlerini değiştirmeden string literal'ları bölmek veya soru işaretini kaçırmak. `-Werror` ya da güvenli dosya erişim kontrolleri kapatılmamalı. Sonrasında dört Linux matris işi yeniden çalıştırılmalı; mevcut sonuç Linux güvenlik testlerinin geçtiğine kanıt değildir.

### 2. Windows MSVC hazırlığı — P1

Windows x64 / Node 22 ve 24, `node .github/scripts/prepare-native.mjs` adımında `MSVC environment setup failed` ile durdu. Native derleme ve güvenlik testleri başlamadı.

Kanıt: [Windows / Node 22 logu](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34221182771/job/102044415780), [Windows / Node 24 logu](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34221182771/job/102044415842).

`prepare-native.mjs:69–74`, `VsDevCmd.bat` çağrısını `cmd.exe /d /s /c` üzerinden yapıyor. Nonzero çıkış görülüyor; `environment.error`, stderr ve stdout hata durumunda raporlanmadığından alt komutun kesin hata nedeni logdan çıkarılamıyor. Bu aşamada eksik MSVC kurulumu veya kesin bir quoting hatası iddia edilmez; `vswhere` kontrolü önceki aşamayı geçmiş.

Düzeltme yönü: güvenli ve sınırlı tanılama çıktısı eklemek, cmd/batch argüman aktarımını Windows üzerinde doğrulamak. Ortamın tamamını veya sır içerebilecek env değişkenlerini loglamamak. İki Windows job'ı native test ve temiz tarball/MCP adımlarına kadar yeniden çalıştırılmalı.

## Diğer sonuçlar

- macOS arm64/x64 × Node 22/24 işlerinin dördü geçti: test, paketleme ve temiz kurulum/MCP adımları başarılı.
- .NET `net8.0 + net10.0` test işi geçti.
- `pack SkMcp.AspNetCore` işi, başarısız bağımlılıkları nedeniyle atlandı; beş native hedefi birleştiren npm artifact'ı üretilmedi.
- Genel Node işinde native build hatasına ek olarak .NET formatter `Restore operation failed` çıktısı var. Turbo'nun hata sonrası diğer işleri sonlandırdığı sırada geldiğinden bağımsız kök neden olduğu kanıtlanmamıştı. Sonraki genel Node build/lint işleri geçti; ayrı restore engeli tekrar oluşmadı.
- Node 22'de workspace `engines >=24` uyarısı var; mevcut başarısızlık bunun yüzünden değil. Action Node 20 deprecation uyarıları da bu iki engelin nedeni değil.

## İlk çalışmanın geçiş kararı

İlk çalışmada CI yeşil değildi; native/genel Node hataları birleşik paket kanıtını engelliyordu. Bu ilk sonuçla XML geçiş kapısı kapalı tutuldu. Sonraki düzeltmeler ve başarılı çalışma aşağıda kayıtlıdır.

## Sonraki düzeltme ve doğrulama turları

Yukarıdaki sonuç ilk merge çalışmasının tarihsel kaydıdır. Kullanıcının isteğiyle düzeltmeler doğrudan `main` üzerinde commit/push edildi; merge edilmiş `excel-file-core-hardening` branch'i yerel ve uzak depodan silindi.

| Commit    | Değişiklik                                                                                 | CI kanıtı                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2212d16` | GCC trigraph literal düzeltmesi; Windows cmd argüman aktarımı ve sınırlı stderr tanılaması | [34222444100](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34222444100): Linux ve MSVC hazırlığı geçti; Windows erişim testleri hata yakaladı     |
| `13cb74c` | Windows 8.3 yol alias normalizasyonu; bağımsız dizin tarama kontrolü                       | [34222870783](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34222870783): symlink alias hataları giderildi; Win32 dizin reopen erişim hatası sürdü |
| `30a6f0a` | Windows dizinlerini boş NT göreli adla kök handle üzerinden yeniden açma                   | [34223235373](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34223235373): Windows test/paket/MCP geçti; bağımsız .NET test sayacı yarışı yakalandı |
| `7e9645c` | .NET test probe sayacı host'a özel; iki paralel host regresyonu                            | [34223587567](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34223587567): Windows/.NET geçti; macOS x64 birleşik CSV testi süreyi aştı             |
| `a033103` | Büyük CSV parser/handler testlerini ayırma; test concurrency sınırı                        | [34224085196](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34224085196): 13/13 başarılı; birleşik paket üretildi                                  |

.NET değişikliği ürün cache davranışını değiştirmez. Paralel test host'larının ortak statik sayacı birbirini etkiliyordu; sayaç host'a taşındı. Test paralelliği ve assertion'lar korundu. Yerelde `net8.0` ve `net10.0` için 164'er test ve lint geçti. Native eşzamanlı dizin taramaları da ayrı enumeration state ile doğrulandı.

`7e9645c` turunda macOS x64 / Node 24 tek bir birleşik CSV testinde 30 saniyeyi aştı. `a033103`, tam 16 MiB parser ve handler kontrollerini ayrı testlere böldü ve test worker sayısını ikiyle sınırladı; byte/hücre/regex/watchdog limitleri değiştirilmedi. Güncel native/file-core/Excel toplamı 450 test. Bu commit'in CI'ı tamamen geçti.

Paket job'ı `SKMCP_REQUIRE_ALL_PREBUILDS=1` ile beş binary'yi doğruladı; üç npm tarball'ının denetimi ve temiz kurulumdan snapshot/regex MCP çağrıları başarılı. npm yayını yapılmadı. Excel/file-core güvenlik kapısı kapandı; XML parser/tool geliştirmesi başlatılmadı.
