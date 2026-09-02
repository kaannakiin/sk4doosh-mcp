# Tool İsimlendirme

> Statü: **hipotez v0** — iki bağımsız doğrulaması (iki backend / iki framework) olmayan kural normatif değildir.

Her SDK aynı endpoint kümesinden aynı isimleri üretmek zorundadır; [conformance](../conformance) `naming/` fixture'ları bu dökümanı sınar.

## Kurallar

1. Tool adı şu deseni sağlamalıdır: `^[a-z][a-z0-9_]{0,255}$`.
2. `operationId` tanımlıysa ad, `operationId`'nin snake_case'e çevrilmiş halidir.
3. `operationId` yoksa ad üretilir: `{metod}_{statik route parçaları}_by_{path parametreleri}`.
4. Aynı kümede iki endpoint aynı adı üretiyorsa bu bir **hatadır** (`name_collision`). SDK sessizce sonek ekleyemez; başlangıçta/build'de açık hata verir ve `operationId` ister. Gerekçe: sessiz `_2` soneki, komşu endpoint eklendiğinde var olan tool'un adını kaydırır — agent'ların öğrendiği isimler stabil kalmalıdır.
5. Üretilen ad deseni sağlamıyorsa bu da hatadır (`invalid_name`); çözüm `operationId` tanımlamaktır.

## Uzunluk sınırı neden 256

Desen bir zamanlar 64 karakterle sınırlıydı. Bu sayının ne MCP'de ne de model API'lerinde bir karşılığı yok: MCP şemasında (`schema/2025-06-18`) `Tool.name` düz `string`'dir — `maxLength`, `minLength`, `pattern` taşımaz; Anthropic API'sinde tool adı uzayı `^[a-zA-Z0-9_-]{1,256}$`'dir.

Kuralın iki yarısının maliyeti zıt olduğu için ayrı ele alınırlar:

- **Karakter kümesi katı kalır** (`[a-z]`, `[a-z0-9_]`). Adı SDK üretir; küçük harfe ve `_`'ye çevirmek hiçbir endpoint'i reddetmez, yalnızca biçim garantisi verir. Model API'lerinin izin verdiği büyük harf ve `-` bilinçli olarak kullanılmaz.
- **Uzunluk sınırı gevşer.** Karakter kümesinin aksine uzunluk _reddeder_: protokolde gerekçesi olmayan bir tavan, geçerli bir endpoint'i build hatasına çevirir. Ölçüm: 718 endpoint'lik gerçek bir backend'de route'tan üretim yolu 38 endpoint'te (%5.3) yalnızca 64 sınırı yüzünden `invalid_name` veriyordu.

Uzun adın gerçek maliyeti agent context'i ve arama kalitesidir — bu bir kalite sorunudur, yaptırımla değil **uyarıyla** yönetilir: SDK 64 karakteri aşan adlar için ölümcül olmayan bir tanı (`long_tool_name`) üretir.

## snake_case çevrimi

- Tümü küçük harfe çevrilir. Büyük harften önce `_` **yalnızca** şu iki durumda eklenir:
  stma kuralının gerekçesi ölçümdür: "her büyük harften önce `_`" kuralı 718 endpoint'lik gerçek bir backend'de 29 adı (%4) okunamaz hale getiriyordu — `GetMappingDTOProperties` → `get_mapping_d_t_o_properties`, `WS_GetTree` → `w_s_get_tree`, `AIDocument` → `a_i_document`. Tool adı agent'ın birincil arama sinyali olduğu için bu doğrudan keşfi bozar. Yeni kuralla: `get_mapping_dto_properties`, `ws_get_tree`, `ai_document`.

## Bir operasyon, bir tool

Bir operasyon birden çok route'a bağlıysa (uyumluluk için tutulan eski yol + yeni yol) **tek tool** üretilir. Operasyon kimliği `(container, operationId, metod)` üçlüsüdür; üçü de eşit olan endpoint'ler aynı operasyondur. Route deterministik seçilir: en kısa route, eşitlikte ordinal karşılaştırmada en küçüğü.

Gerekçe: tool bir operasyondur, bir route değil. Uyumluluk route'ları bir dağıtım meselesidir, agent'ı ilgilendirmez; iki neredeyse-aynı tool arama sonuçlarını kirletir. Ölçüm: gerçek backend'deki 15 ad çakışmasının 10'u bu vakaydı (tek metotta iki route attribute'u) — ve kural 4'ün çözümü ("`operationId` tanımla") burada işlemez, çünkü zaten tek ve doğru bir `operationId` var.

`operationId` tanımlı değilse gruplama yapılmaz: route'tan üretilen adlar zaten route başına farklıdır.

Kimliğin `container`'ı içermesi zorunludur. Yalnız `(operationId, metod)` ile gruplamak, farklı container'lardaki aynı adlı iki ayrı operasyonu (`Delete` action'ı iki farklı controller'da) sessizce birleştirirdi.

## Route'tan üretim

- Metod küçük harfe çevrilir ve başa gelir.
- Route'un statik parçaları sırayla, `_` ile birleştirilir; parça içindeki alfanümerik olmayan karakterler `_` olur.
- Path parametreleri (süslü parantezli parçalar) sırayla, her biri `by_{ad}` olarak sona eklenir. Route kısıtları (`{id:int}` gibi) addan atılır.

## Örnekler

| Girdi                                                                 | Ad                              |
| --------------------------------------------------------------------- | ------------------------------- |
| `operationId: GetOrder`                                               | `get_order`                     |
| `operationId: GetQRDetailsByToken`                                    | `get_qr_details_by_token`       |
| `GET /ping`                                                           | `get_ping`                      |
| `GET /orders/{id}`                                                    | `get_orders_by_id`              |
| `POST /orders/{orderId}/items`                                        | `post_orders_items_by_order_id` |
| `GET /orders/{id}` + `operationId: GetOrdersById` olan başka endpoint | hata: `name_collision`          |
