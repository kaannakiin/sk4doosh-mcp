# Tool İsimlendirme

> Statü: **hipotez v0** — iki bağımsız doğrulaması (iki backend / iki framework) olmayan kural normatif değildir.

Her SDK aynı endpoint kümesinden aynı isimleri üretmek zorundadır; [conformance](../conformance) `naming/` fixture'ları bu dökümanı sınar.

## Kurallar

1. Tool adı şu deseni sağlamalıdır: `^[a-z][a-z0-9_]{0,63}$`.
2. `operationId` tanımlıysa ad, `operationId`'nin snake_case'e çevrilmiş halidir.
3. `operationId` yoksa ad üretilir: `{metod}_{statik route parçaları}_by_{path parametreleri}`.
4. Aynı kümede iki endpoint aynı adı üretiyorsa bu bir **hatadır** (`name_collision`). SDK sessizce sonek ekleyemez; başlangıçta/build'de açık hata verir ve `operationId` ister. Gerekçe: sessiz `_2` soneki, komşu endpoint eklendiğinde var olan tool'un adını kaydırır — agent'ların öğrendiği isimler stabil kalmalıdır.
5. Üretilen ad deseni sağlamıyorsa (ör. 64 karakteri aşıyorsa) bu da hatadır (`invalid_name`); çözüm `operationId` tanımlamaktır.

## snake_case çevrimi

- Büyük harften önce `_` eklenir, tümü küçük harfe çevrilir: `GetOrder` → `get_order`, `getOrderById` → `get_order_by_id`.
- Alfanümerik olmayan her karakter `_` olur; ardışık `_`'lar teke iner; baş/son `_` atılır.

## Route'tan üretim

- Metod küçük harfe çevrilir ve başa gelir.
- Route'un statik parçaları sırayla, `_` ile birleştirilir; parça içindeki alfanümerik olmayan karakterler `_` olur.
- Path parametreleri (süslü parantezli parçalar) sırayla, her biri `by_{ad}` olarak sona eklenir. Route kısıtları (`{id:int}` gibi) addan atılır.

## Örnekler

| Girdi                                                                 | Ad                              |
| --------------------------------------------------------------------- | ------------------------------- |
| `operationId: GetOrder`                                               | `get_order`                     |
| `GET /ping`                                                           | `get_ping`                      |
| `GET /orders/{id}`                                                    | `get_orders_by_id`              |
| `POST /orders/{orderId}/items`                                        | `post_orders_items_by_order_id` |
| `GET /orders/{id}` + `operationId: GetOrdersById` olan başka endpoint | hata: `name_collision`          |
