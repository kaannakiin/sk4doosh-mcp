# Tool İsimlendirme

> Statü: **normatif** — iki bağımsız implementasyonla doğrulandı (ASP.NET Core `ToolNameFactory` + TS `createToolNames`, iki çerçevenin keşif katmanı da aynı `naming/` korpusunu besliyor).

Her SDK aynı endpoint kümesinden aynı isimleri üretmek zorundadır; [conformance](../conformance) `naming/` fixture'ları bu dökümanı sınar.

## Kurallar

1. Tool adı şu deseni sağlamalıdır: `^[a-z][a-z0-9_]{0,255}$`.
2. Adın **gövdesi**, `operationId` tanımlıysa onun snake_case'e çevrilmiş halidir.
3. `operationId` yoksa gövde üretilir: `{metod}_{statik route parçaları}_by_{path parametreleri}`.
4. Gövdenin önüne container prefix'i gelir (aşağıdaki bölüm).
5. Prefix uygulandıktan sonra iki endpoint hâlâ aynı adı üretiyorsa bu bir **hatadır** (`name_collision`). SDK sessizce sonek ekleyemez; başlangıçta/build'de açık hata verir. Gerekçe: sessiz `_2` soneki, komşu endpoint eklendiğinde var olan tool'un adını kaydırır ve agent'a hangi tool'un hangi kaynağa ait olduğunu söylemez — agent'ların öğrendiği isimler stabil ve anlamlı kalmalıdır.
6. Üretilen ad deseni sağlamıyorsa bu da hatadır (`invalid_name`); çözüm `operationId` veya açık ad tanımlamaktır.

## Container prefix'i

Tool adları **düz** bir isim uzayında yaşar, HTTP route'ları ise hiyerarşiktir. Hiyerarşik bir kümeyi düz uzaya taşırken ya hiyerarşinin bir parçası ada girer ya çakışılır. Operasyon kimliğinin parçası olan `container` ([bir operasyon, bir tool](#bir-operasyon-bir-tool)), bu yüzden üretilen adın da parçasıdır: kimliği belirleyen bir alanın addan düşürülmesi, çakışmayı tasarımın içine koyar.

1. Container'ı olan her endpoint'in adı `{prefix}_{gövde}` biçimindedir. Mod default `Always`.
2. Container'ı olmayan endpoint (minimal API, route handler) prefix **almaz**: prefix'in kaynağı yoktur ve route'tan üretilen gövde hiyerarşiyi zaten taşır.
3. Prefix çözümü — **en özel kazanır** ([seçim hiyerarşisiyle](secim-hiyerarsisi.md) aynı desen):
   1. Operasyon açık bir tam ad beyan ettiyse o ad kullanılır, prefix uygulanmaz.
   2. Container açık bir prefix beyan ettiyse o kullanılır.
   3. Host global bir prefix kuralı verdiyse ve kural bu container için bir değer döndürdüyse o kullanılır. Kural değer döndürmezse sıradaki adıma düşülür.
   4. Aksi halde container'dan türetilir: container adının son segmenti alınır, sonundaki `Controller` kelimesi atılır, snake_case'e çevrilir. (`Web.Controllers.PushProviderConfigController` → `push_provider_config`)
4. **Tekrar bastırma.** Prefix'in token dizisi gövdenin token dizisinde ardışık olarak geçiyorsa prefix eklenmez. Karşılaştırmada [arama semantiğinin](arama-semantigi.md) sondaki `s` katlaması uygulanır. Gerekçe: `SupportRequestController.CreateSupportRequest` aksi halde `support_request_create_support_request` üretirdi; ad uzunluğu agent context'i ve arama kalitesidir. Katlama bilinçli olarak yalnız sondaki `s`'yi kapsar: `TaskActivitiesController.SaveTaskActivity` → `task_activities_save_task_activity`. `ies`/`y`, `ves`/`f` gibi çiftleri eklemek SDK'yı dil morfolojisi motoruna çevirir ve düzensiz çoğullarda yine durur; bu vakalarda çıkış yolu prefix veya tam ad beyanıdır.
5. `PrefixMode = OnCollision` seçilirse prefix yalnız aynı gövdeyi üreten endpoint'lere uygulanır — ve o gruptaki **hepsine** uygulanır, birine değil. Uygulandığında ölümcül olmayan bir tanı üretilir (`name_disambiguated`). Tek tarafa uygulamak keyfi olurdu: hangi tarafın çıplak adı koruyacağı ancak alfabetik sıra, route uzunluğu veya keşif sırası gibi anlamsız bir ölçütle seçilebilir, ve üçüncü bir endpoint eklendiğinde kazanan değişerek var olan bir tool'un adını kaydırırdı.
6. `Always` modunda prefix normal davranıştır, tanı üretmez.

Prefix'in kaynağı `container` olduğu için ad, hiyerarşinin yalnız **bir** seviyesini taşır. Route'un tamamı ada girmez: `{prefix}_{gövde}` iki seviyeyle sınırlıdır ve gövde route'tan üretildiğinde route parçalarını zaten içerir.

## Uzunluk sınırı neden 256

Desen bir zamanlar 64 karakterle sınırlıydı. Bu sayının ne MCP'de ne de model API'lerinde bir karşılığı yok: MCP şemasında (`schema/2025-06-18`) `Tool.name` düz `string`'dir — `maxLength`, `minLength`, `pattern` taşımaz; Anthropic API'sinde tool adı uzayı `^[a-zA-Z0-9_-]{1,256}$`'dir.

Kuralın iki yarısının maliyeti zıt olduğu için ayrı ele alınırlar:

- **Karakter kümesi katı kalır** (`[a-z]`, `[a-z0-9_]`). Adı SDK üretir; küçük harfe ve `_`'ye çevirmek hiçbir endpoint'i reddetmez, yalnızca biçim garantisi verir. Model API'lerinin izin verdiği büyük harf ve `-` bilinçli olarak kullanılmaz.
- **Uzunluk sınırı gevşer.** Karakter kümesinin aksine uzunluk _reddeder_: protokolde gerekçesi olmayan bir tavan, geçerli bir endpoint'i build hatasına çevirir. Ölçüm: 718 endpoint'lik gerçek bir backend'de route'tan üretim yolu 38 endpoint'te (%5.3) yalnızca 64 sınırı yüzünden `invalid_name` veriyordu.

Uzun adın gerçek maliyeti agent context'i ve arama kalitesidir — bu bir kalite sorunudur, yaptırımla değil **uyarıyla** yönetilir: SDK 64 karakteri aşan adlar için ölümcül olmayan bir tanı (`long_tool_name`) üretir.

## snake_case çevrimi

- Tümü küçük harfe çevrilir. Büyük harften önce `_` **yalnızca** şu iki durumda eklenir:
  1. Önceki karakter küçük harf veya rakamsa (`GetOrder` → `get_order`).
  2. Önceki karakter büyük harf, sonraki karakter küçük harfse — yani ardışık büyük harf dizisi bitiyorsa (`GetQRDetails` → `get_qr_details`).
- Alfanümerik olmayan karakterler `_` olur, ardışık `_` teke iner, baştaki ve sondaki `_` atılır.

Kısaltma kuralının gerekçesi ölçümdür: "her büyük harften önce `_`" kuralı 718 endpoint'lik gerçek bir backend'de 29 adı (%4) okunamaz hale getiriyordu — `GetMappingDTOProperties` → `get_mapping_d_t_o_properties`, `WS_GetTree` → `w_s_get_tree`, `AIDocument` → `a_i_document`. Tool adı agent'ın birincil arama sinyali olduğu için bu doğrudan keşfi bozar. Yeni kuralla: `get_mapping_dto_properties`, `ws_get_tree`, `ai_document`.

## Bir operasyon, bir tool

Bir operasyon birden çok route'a bağlıysa (uyumluluk için tutulan eski yol + yeni yol) **tek tool** üretilir. Operasyon kimliği `(container, operationId, metod)` üçlüsüdür; üçü de eşit olan endpoint'ler aynı operasyondur. Route deterministik seçilir: en kısa route, eşitlikte ordinal karşılaştırmada en küçüğü.

Gerekçe: tool bir operasyondur, bir route değil. Uyumluluk route'ları bir dağıtım meselesidir, agent'ı ilgilendirmez; iki neredeyse-aynı tool arama sonuçlarını kirletir. Ölçüm: gerçek backend'deki 15 ad çakışmasının 10'u bu vakaydı (tek metotta iki route attribute'u) — ve "`operationId` tanımla" çözümü burada işlemez, çünkü zaten tek ve doğru bir `operationId` var.

`operationId` tanımlı değilse gruplama yapılmaz: route'tan üretilen adlar zaten route başına farklıdır.

Kimliğin `container`'ı içermesi zorunludur. Yalnız `(operationId, metod)` ile gruplamak, farklı container'lardaki aynı adlı iki ayrı operasyonu (`Delete` action'ı iki farklı controller'da) sessizce birleştirirdi.

## Örnekler

| Girdi                                                                       | Ad                                    |
| --------------------------------------------------------------------------- | ------------------------------------- |
| `operationId: GetOrder`, container yok                                      | `get_order`                           |
| `operationId: GetQRDetailsByToken`, container yok                           | `get_qr_details_by_token`             |
| `GET /ping`, container yok                                                  | `get_ping`                            |
| `GET /orders/{id}`, container yok                                           | `get_orders_by_id`                    |
| `POST /orders/{orderId}/items`, container yok                               | `post_orders_items_by_order_id`       |
| `operationId: List`, container `PushProviderConfigController`               | `push_provider_config_list`           |
| `operationId: CreateSupportRequest`, container `SupportRequestController`   | `create_support_request` (bastırıldı) |
| `operationId: GetOrder`, container `OrdersController`                       | `get_order` (bastırıldı, `s` katlama) |
| `operationId: List`, container `OrdersController`                           | `orders_list`                         |
| `operationId: List`, container `PushProviderConfigController`, prefix `cfg` | `cfg_list`                            |
| `operationId: Save` × POST + PUT, aynı container                            | hata: `name_collision`                |
| `GET /orders/{id}` + `operationId: GetOrdersById`, ikisinde container yok   | hata: `name_collision`                |
