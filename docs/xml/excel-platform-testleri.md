# Excel/file-core platform testlerini çalıştırma

Durum: macOS arm64 / Node 24 yerel testleri geçti. Aşağıdaki Linux/Windows ve diğer platform çalışmaları henüz yapılmadı. Workflow hazırlanması testin geçtiği anlamına gelmez.

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

## Bu dal için ilk çalıştırma

1. Depo kökünde `git push -u origin excel-file-core-hardening` çalıştır.
2. GitHub'da bu daldan `main` dalına bir pull request aç. Taslak PR kullanılabilir. CI, `pull_request` olayıyla başlar; testleri başlatmak için merge gerekmez.
3. PR'ın **Checks** bölümünden veya yukarıdaki Actions bağlantısından çalışmayı aç.
4. `secure files (linux-x64, Node 22)` gibi on işin sonuçlarını incele. Windows için `secure files (win32-x64, Node 22)` ve `Node 24` işlerini kontrol et.

Bu dal şu anda yalnız yerelde kaydedildi; bu çalışma uzaktaki depoya push veya PR oluşturma yapmadı. Workflow'un `push` tetikleyicisi yalnız `main` için tanımlıdır: feature dalını push etmek tek başına CI başlatmaz.

## Daha sonraki manuel çalıştırmalar

Workflow'a `workflow_dispatch` eklendi. Bu tanım varsayılan dala girdikten sonra **Actions → CI → Run workflow** üzerinden dal seçilerek çalıştırılabilir. GitHub CLI alternatifi: `gh workflow run ci.yml --ref excel-file-core-hardening`.

Manuel çalıştırmanın varsayılan dal koşulu [GitHub'ın resmi açıklamasında](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) yer alır. İlk doğrulama için PR yöntemi kullanılır; yalnız manuel düğmeyi görünür yapmak amacıyla doğrulanmamış kod merge edilmez.

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
