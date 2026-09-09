# F0 — Kanıt ve karar kapısı

Durum: **tamamlandı** (2026-09-09). Kanıt: [run 34289898377](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34289898377), commit `6bc8486`, beş hedef × Node 22/24 = 10/10 ayak, 80/80 kayıt pass, hiçbiri inconclusive değil. F0-01–09 sonuçları [F0 kanıt kaydında](../f0-kanit-kaydi.md), bağımlılık olguları [karar ekinde](../bagimlilik-karar-eki.md). Sorumlu: XML geliştiricisi; doğrulayan: bağımsız inceleyici. Deney harness'ı `packages/xml-lab`; `packages/xml-mcp` hâlâ mevcut değil ve F0 onu oluşturmaz.

## Güncel başlangıç noktası

[Ortak çekirdek ve Excel kapanışı](01-ortak-cekirdek-ve-excel.md), kök handle'ına bağlı erişim, byte snapshot'ı ve platform paketlerini sağlıyor. Bu fazın dokuz görevi de kapandı; F0'ın kapıları artık regresyon olarak `packages/xml-lab` süitinde korunuyor. Excel regex worker testleri XML parse/XPath, WASM disposal veya dış kaynak çözümlemesi için kabul kanıtı değildir. F0-02'deki native derleme gerektirmeme ölçütü son kullanıcı kurulumuna aittir; file-core hazır native paket kullanır.

## Hedef

`libxml2-wasm` tercihini hedef dağıtımda doğrulamak, güvenlik/encoding/worker/bellek iddialarını ölçümle ayırmak. Kaynak: [kararlar](../kararlar.md), [araştırma izi](../kaynaklar.md).

| Görev | Yapılacak iş                                                                                                          | Somut çıktı                            | Kabul ölçütü                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| F0-01 | Tam paket sürümü, npm integrity, wrapper ve gömülü libxml2 lisansı/sürümü, advisory kapsamı kaydet                    | Bağımlılık karar eki                   | Wrapper için boş advisory sonucu alttaki C kütüphanesinin güvenliği sayılmaz; dağıtılan artifact sürümü belli |
| F0-02 | Node 22/24 ESM, stdio başlangıcı ve WASM dosya çözümlemesini izole tüketici ortamında dene                            | Kurulum ve cold-start kaydı            | Native derleme/JDK gerekmiyor; stdout'ta protokol dışı metin yok; pack içindeki WASM yükleniyor               |
| F0-03 | Default namespace, prefix rebinding, aynı local name/farklı URI, attribute namespace ve XPath scalar sonuçlarını dene | Semantik fixture sonuçları             | Hiçbir URI yanlış alanla eşleşmiyor; false/0/boş sonuç korunuyor                                              |
| F0-04 | UTF-8/UTF-16LE/BE, BOM/declaration uyuşmazlığı, bozuk byte ve legacy encoding davranışını ölç                         | Desteklenen encoding matrisi           | Kabul edilen girdinin metni exact beklenen Unicode; sessiz bozuk decode yok; desteklenmeyen açık hata         |
| F0-05 | DTD/entity/XInclude/schema hint fixture'larını ağ ve sandbox dışı dosya canary'siyle dene                             | Güvenlik kapısı sonuçları              | Hiç dış erişim yok; DOCTYPE politika hatası; yanlış XML recovery ile kabul edilmiyor                          |
| F0-06 | Parse ve XPath timeout, iptal, worker sonlandırma, yeniden başlatma ve shutdown dene                                  | Worker yaşam döngüsü kaydı             | Timeout yanıtından sonra iş sürmüyor; sonraki normal çağrı çalışıyor; kuyruk ve snapshot temizleniyor         |
| F0-07 | Aç/kapat, hata, cache tahliyesi, compiled XPath disposal senaryolarını tekrarla                                       | Kaynak ömrü ve bellek grafiği          | Kullanılmayan DOM tutulmuyor; tekrarlar boyunca açıklanamayan sürekli bellek artışı yok                       |
| F0-08 | 1/4/8 MiB normal, yoğun attribute ve derin belgeyle latency/RSS/external/WASM gözlemleri al                           | Ölçüm tablosu ve final bütçeler        | Host/Node/sürüm/fixture hash ve cold/warm farkı belli; hedef dışına çıkan şekil reddediliyor                  |
| F0-09 | Bulguları seçilen stack kararıyla ilişkilendir                                                                        | Kabul veya gerekçeli stack değişikliği | Aşağıdaki çıkış kapısı sağlanıyor                                                                             |

## Deney kuralları

Tehlikeli fixture'lar normal test runner sürecinde sınırsız çalıştırılmaz. İzole, süreli ve kaynak bütçeli ortam kullanılır. Bir 8 MiB dosyanın kabulü tüm 8 MiB XML şekillerinin aynı bellek maliyetine sahip olduğunu göstermez; text-heavy, node-heavy, attribute-heavy örnekler ayrı ölçülür. İlk sınır üstündeki dosya daha parse edilmeden reddedilmelidir.

DOCTYPE kontrolünde yorum, CDATA, UTF-16 ve chunk sınırı fixture'ları gerekir. Regex ile byte taraması tek XML güvenlik sınırı yapılmaz. Motor dış çözümlemeyi zaten kapalı tutarken doğru declaration tespiti bağımsız kanıtlanır.

## Çıkış kapısı

F0-01–09 sonuçları tekrar üretilebilir kanıtla tamamlanır. Dış I/O kapatılamıyorsa, encoding sessiz bozuluyorsa, disposal/iptal güvenilir değilse veya WASM dağıtımı çalışmıyorsa F2 bloke olur. Sırf benchmark hedefi aşıldı diye güvenlik bayrakları gevşetilmez; dosya sınırı düşürülür veya [alternatif motorlar](../kararlar.md) yeniden karşılaştırılır. Başarısız tercih değişikliği aynı fixture matrisiyle sınanır.
