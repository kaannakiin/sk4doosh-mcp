# Excel/file-core platform testlerini çalıştırma

Platform testleri artık `main` üzerinde GitHub Actions'ta çalıştırılıyor. Güncel run/commit sonucu [kapanış kaydında](excel-hardening-uygulama.md), önceki hatalar ve düzeltmeler [CI inceleme kaydında](excel-ci-inceleme-2026-09-08.md). Workflow'un hazırlanması tek başına testin geçtiği anlamına gelmez.

## Nerede çalışacak?

[GitHub Actions — CI](https://github.com/kaannakiin/sk4doosh-mcp/actions/workflows/ci.yml), GitHub'ın sağladığı ayrı runner makinelerini kullanır. Kendi Mac'ine Linux veya Windows kurman gerekmez. Tanım: [ci.yml](../../.github/workflows/ci.yml).

`secure files (...)` adlı işler aşağıdaki beş hedefi Node **22 ve 24** ile çalıştırır; toplam **10 matris işi** vardır.

| Native hedef      | GitHub runner      | Node   |
| ----------------- | ------------------ | ------ |
| Linux glibc x64   | `ubuntu-24.04`     | 22, 24 |
| Linux glibc arm64 | `ubuntu-24.04-arm` | 22, 24 |
| macOS x64         | `macos-15-intel`   | 22, 24 |
| macOS arm64       | `macos-15`         | 22, 24 |
| Windows x64       | `windows-2022`     | 22, 24 |

## Main üzerinden çalıştırma

1. Düzeltmeyi `main` üzerinde commit ettikten sonra `git push origin main` çalıştır. `push` tetikleyicisi CI'ı başlatır.
2. Alternatif olarak değişiklik yapmadan **Actions → CI → Run workflow → main** seçilerek doğrulama tekrarlanabilir.
3. Yukarıdaki Actions bağlantısından yeni çalışmayı aç; test edilen commit SHA'sının beklenen commit olduğunu kontrol et.
4. `secure files (linux-x64, Node 22)` gibi on işin sonuçlarını incele. Windows için `secure files (win32-x64, Node 22)` ve `Node 24` işlerini kontrol et.

Önceki `excel-file-core-hardening` branch'i PR #1 ile merge edildi ve kullanıcı isteğiyle yerel/uzak depodan silindi. Düzeltmeler doğrudan `main` üzerinde yürütüldü. Gelecekte başka bir feature branch kullanılırsa yalnız o branch'i push etmek CI başlatmaz; `pull_request` tetikleyicisi için PR açılır.

## Daha sonraki manuel çalıştırmalar

`workflow_dispatch` tanımı varsayılan dalda bulunuyor. **Actions → CI → Run workflow** üzerinden dal seçilerek çalıştırılabilir. GitHub CLI alternatifi: `gh workflow run ci.yml --ref main`.

Manuel çalıştırmanın varsayılan dal koşulu [GitHub'ın resmi açıklamasında](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) yer alır. Bu depoda koşul sağlandı; ayrıca branch veya PR oluşturmak gerekmez.

## Her iş neyi doğrular?

1. Node header dosyalarını resmi kaynaktan SHA-256 kontrolüyle hazırlar; Windows için `node.lib` ve MSVC ortamını kurar.
2. Native paketi o işletim sisteminde derler; Turbo bağımlılık build'leriyle native/file-core/Excel testlerini ve type-check'i çalıştırır.
3. Üç npm tarball'ını üretir; native binary ve regex worker dosyalarının pakete girdiğini kontrol eder.
4. Tarball'ları temiz geçici projeye kurar; gerçek stdio MCP üzerinden CSV okuması ve regex araması yapar.

Native watchdog; özel dosya, symlink/junction, kök dışı erişim ve leaf/ancestor yarışlarını sınar. FIFO/socket ve POSIX descriptor sayımı yalnız POSIX platformlarında çalışır. Windows işi kendi handle/junction yollarını çalıştırır; çalıştırılmamış bir POSIX testi Windows kanıtı sayılmaz.

Node 24 işlerinin `native-*` artifact'ları son `pack` işinde birleştirilir. Bu iş beş hedef binary'sini zorunlu kontrol eder ve `npm-tarballs` artifact'ını üretir; npm'e yayın yapmaz. `pack` işi genel Node ve .NET işlerine de bağlıdır; bu işlerden biri başarısızsa native testler geçse bile paket toplama işi bekler/atlanır.

## Sonuç nasıl kaydedilecek?

[Uygulama kaydına](excel-hardening-uygulama.md) CI run URL'si, test edilen commit SHA'sı, on matris işinin sonucu ve `npm-tarballs` artifact'ı eklenir. Hata varsa ilgili job/step adı ve log bağlantısı kaydedilir. Kaynak düzeltmesinden sonra PR'a yeni commit push edilmesi CI'ı yeniden çalıştırır.

Platform matrisi ve beş binary içeren temiz paket kanıtı tamamlanmadan XML geçiş kapısı açılmaz. #9/#10/#25 metadata sınırlılıkları bu testlerle tam destek kazanmış sayılmaz; ayrı takip kayıtları açık kalır.
