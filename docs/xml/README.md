# XML MCP — Araştırmadan uygulama planına

Tarih: 2026-09-08. Durum: **Excel/file-core güvenlik ve platform CI kapısı geçti. XML uygulaması başlamadı.**

Güncel kaynak/doküman tabanı `6b2bc89`; [CI #34226587889](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34226587889) 13/13 başarılı. Beş native hedef × Node 22/24, gerçek MCP ve birleşik paket doğrulaması tamamlandı. Son kod düzeltmesi `4472332` ve bulgu bazlı kanıtlar [kapanış kaydında](excel-hardening-uygulama.md). XML paketi henüz yok; aşağıdaki XML fazları uygulama planıdır.

## Hedef

Agent, yerel XML belgesinin yapısını öğrenebilmeli, namespace kimliğini kaybetmeden belirli düğümleri okuyabilmeli ve sınırlı sonuçlarla arama yapabilmeli. Ardından XPath ve kayıt projeksiyonu eklenebilir. Kaynak dosya değişmez. XML içeriğindeki URI, şema konumu veya yönergeler kendiliğinden dosya ya da ağ erişimi başlatmaz.

`@sk-mcp/xml-mcp`, `@sk-mcp/file-core` tüketen bağımsız bir ürün paketi olacaktır. `@sk-mcp/core` HTTP katalog çekirdeğidir; XML paketinin bağımlılığı değildir. Mevcut kararlar: [paket yerleşimi](../paket-yerlesimi.md), [dosya çekirdeği](../kararlar/015-dosya-kaynagi-cekirdegi.md), [Excel semantiği](../kararlar/005-excel-okuma-semantikleri.md).

## Okuma sırası

1. [Kütüphane ve mimari kararları](kararlar.md): seçilen yaklaşım, alternatifler, reddedilen araştırma varsayımları.
2. [Tool ve veri sözleşmesi](tool-sozlesmesi.md): agent'ın gördüğü davranış, namespace, cursor, kısmi sonuç ve hata kuralları.
3. [Faz planları](fazlar/): görevler, önkoşullar, çıktılar ve kabul ölçütleri.
4. [Test ve değerlendirme planı](test-stratejisi.md): doğruluk, kaynak bütçesi ve gerçek agent senaryoları.
5. [Excel/file-core bulguları](excel-file-core-bulgular.md): eski denetimin mevcut kaynakla karşılaştırılması.
6. [Kaynaklar ve devir kaydı](kaynaklar.md): araştırma izi, güncel doğrulamalar ve doğrulanmamış iddialar.
7. [Excel uygulama ve kapanış kaydı](excel-hardening-uygulama.md): 35 bulgunun test/fixture/commit kanıtları ve kalan destek sınırları.
8. [Linux/Windows platform testleri](excel-platform-testleri.md): main push ve manuel GitHub Actions çalıştırmaları.

## Faz sırası ve kapsam

| Faz                                                                  | Sonuç                                                  | Önkoşul                             | Durum                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------- | ----------------------------------------------- |
| [F0 — Kanıt ve teknik karar kapısı](fazlar/00-kanit-ve-karar.md)     | XML motorunun gerçek paket üzerinde doğrulanması       | Excel/file-core kapısı geçti        | Tamamlandı; 10/10 platform CI                   |
| [F1 — Ortak çekirdek ve Excel](fazlar/01-ortak-cekirdek-ve-excel.md) | Dosya güvenliği, Excel düzeltmeleri ve XML kaynak ömrü | XML yaşam döngüsü için F0           | Kısmen tamamlandı; F1-03/05/06 XML kapsamı açık |
| [F2 — Salt okunur MVP](fazlar/02-okuma-mvp.md)                       | Dört tool ile keşif, düğüm okuma ve metin arama        | F0 + F1-03/05/06 XML kapsamı        | Başlanmadı                                      |
| [F3 — XPath ve kayıt analizi](fazlar/03-sorgu-ve-kayitlar.md)        | XPath 1.0, açık projeksiyon ve kontrollü aggregate     | F2                                  | Başlanmadı                                      |
| [F4 — Büyük dosya ve çoklu arama](fazlar/04-buyuk-dosya.md)          | DOM sınırının üstünde dar streaming yetenekleri        | F3; ölçülmüş ihtiyaç                | Başlanmadı; isteğe bağlı                        |
| [F5 — Ayrı genişletmeler](fazlar/05-genisletmeler.md)                | XSD, container, dönüşüm ve diff için bağımsız kapılar  | Görevde belirtilen F2/F3 kapısı     | Başlanmadı; isteğe bağlı                        |
| [F6 — Yayın ve agent kabulü](fazlar/06-yayin-ve-kabul.md)            | XML paketinin kurulum, entegrasyon ve kabul kanıtları  | İlk yayın F2; ek özellik ilgili faz | XML için başlanmadı; ortak CI altyapısı hazır   |

İlk yayın yolu **F0 → F1/XML bloklayıcıları → F2 → F6**. XPath isteyen sonraki sürüm F3'ü tamamlar ve F6'yı tekrar uygular. F4 ve F5, MVP'nin bitiş şartı değildir. Kullanıcının kabul ettiği Excel/file-core kapısı tamamlandı: 35 bulgu uygulama, test veya açık destek sınırlılığıyla ele alındı; platform CI ve hazır paket kanıtı alındı. F0 teknik deneyleri ve XML’e özgü F1 işleri henüz tamamlanmadı. #9/#10/#25 tam metadata desteği ayrı takip işleridir; kabul edilen sınırlılıklar belgelenmiştir.

## Yönetim kuralları

- Her görev kimliği sabittir. Durum yalnızca kanıt bağlantısıyla `tamamlandı` yapılır. Yerel başarı, platform CI başarısı yerine geçmez.
- Geliştirici teknik çözümü, doğrulayıcı kabul kanıtını üretir. Test sayısı tek başına kapı değildir.
- Kütüphane tercihi `libxml2-wasm` yönündedir; üretimde benimseme F0 deneylerine bağlıdır. Bu bir kararsız aday listesi değil, başarısızlık koşulları belli bir tercihtir.
- Araştırmadaki 35 bulgu otomatik olarak 35 doğrulanmış güvenlik açığı sayılmaz. Güncel durum ve koşullar bulgu raporundadır.
- Performans sayıları ölçülmeden ürün garantisi yapılmaz. Planın önerdiği başlangıç bütçeleri ölçüm hedefidir.
- Yazma, XSLT çalıştırma, imza doğrulama, genel HTML ayrıştırma ve otomatik dış kaynak takibi bu planın teslim kapsamı dışındadır.

## Tamamlanan teslim ve sıradaki iş

[Excel açık maddeleri karar kaydı](excel-acik-maddeler-karar-kaydi.md), #17/#33/#35 için çalıştırılan hedef testleri ve #26/#27/#28 için kabul edilip uygulanan kararları tutar. [Kapanış kaydı](excel-hardening-uygulama.md) bütün bulguların güncel kanıtıdır.

Excel/file-core regresyonları, kaynak ölçümleri, native erişim ve regex watchdog testleri çalıştırıldı. XML prototipi/parser/tool geliştirmesi yapılmadı. Sıradaki iş F0-01 paket/sürüm/lisans kanıtı ve F0-02–08 motor deneyleridir; Excel güvenlik düzeltmelerini yeniden planlamak değildir.
