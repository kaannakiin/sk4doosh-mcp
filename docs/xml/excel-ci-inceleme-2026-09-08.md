# Merge sonrası Excel/file-core CI incelemesi

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
- Genel Node işinde native build hatasına ek olarak .NET formatter `Restore operation failed` çıktısı var. Turbo'nun hata sonrası diğer işleri sonlandırdığı sırada geldiğinden bağımsız kök neden olduğu henüz kanıtlanmadı; native engel giderildikten sonra tekrar değerlendirilmeli.
- Node 22'de workspace `engines >=24` uyarısı var; mevcut başarısızlık bunun yüzünden değil. Action Node 20 deprecation uyarıları da bu iki engelin nedeni değil.

## Geçiş kararı

CI yeşil değil. Başarısız native/genel Node işleri nedeniyle beş hedef binary'si içeren nihai paket kanıtı tamamlanamaz. XML geçiş kapısı kapalı kalır. Bu inceleme kod düzeltmesi veya başarılı yeniden çalıştırma kanıtı değildir.
