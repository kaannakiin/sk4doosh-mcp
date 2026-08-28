# Nasıl Çalışıyor? — Yetki Katmanına Dokunmadan Taşımak

Bu döküman tek soruyu cevaplar: "Backend'in guard/policy hiyerarşisine dokunuyor muyuz?"

## İki ayrı iş var — karıştırınca kafa karışıyor

| İş                                | Ne zaman              | Hiyerarşiyi anlamamız gerekiyor mu?                                                                   |
| --------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| **Yaptırım** (enforcement)        | `invoke_tool` anında  | **Hayır** — isteği gerçek pipeline'dan geçiririz, framework kendi hiyerarşisini kendisi uygular       |
| **Görünürlük** (arama filtreleme) | `search_tools` anında | **Evet** — endpoint'in etkin yetki kümesini okuyup çağıranın kimliğine karşı değerlendirmemiz gerekir |

### Yaptırım: hiyerarşiye dokunmuyoruz, okumuyoruz bile

Faz 1'in yaptığı şey bir "replay": agent'ın tool çağrısını sentetik bir istek olarak backend'in **kendi** pipeline'ına sokmak. Global guard, controller guard'ı, endpoint guard'ı — hangisi hangi seviyede tanımlıysa framework onları normal bir HTTP isteğinde hangi sırayla uyguluyorsa aynen uygular. Biz bu zincirin ne olduğunu bilmeyiz ve bilmek zorunda değiliz. Kullanıcı yetkiyi istediği seviyede, istediği karışıklıkta yazar — davranış birebir korunur (Faz 1'de 200/401/403 matrisiyle kanıtlandı).

### Görünürlük: hiyerarşiyi çıkarmamız gereken tek yer

"Yetkisi olmayan agent endpoint'i aramada görmesin" için endpoint başına **etkin** yetki kümesi lazım. Burada framework'ler ayrışıyor:

## ASP.NET Core: framework hiyerarşiyi bizim için düzleştiriyor

Routing kurulurken her `Endpoint`'in `Metadata` koleksiyonu, üç seviyeden gelen yetki verisini **tek düz listede** toplar: action attribute'u + controller attribute'u + global convention/`RequireAuthorization` çağrıları. Yani:

- `endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>()` → etkin `[Authorize]` seti, seviye ayrımı çözülmüş halde.
- `AuthorizationPolicy.CombineAsync(policyProvider, authorizeData)` → hepsinin birleşimi tek policy nesnesi.
- Birleşim semantiği **AND**: her seviyedeki gereksinim ayrı ayrı geçilmeli — replay bunu zaten otomatik korur, arama filtresi de aynı birleşik policy'yi `IAuthorizationService` ile değerlendirir.

Cevap: evet, hiyerarşik yapıyı çıkarabiliyoruz — hatta çıkarmıyoruz, framework'ün zaten düzleştirdiği sonucu okuyoruz.

## NestJS: bağlılık okunur, anlam okunamaz

Nest'te üç seviye var: global (`APP_GUARD` provider / `useGlobalGuards`), controller (`@UseGuards` sınıf üstünde), method (`@UseGuards` endpoint üstünde). `Reflector` + DI container ile "bu endpoint'e hangi guard'lar bağlı" listesi çıkarılabilir — hiyerarşi görünür.

Ama kritik fark: ASP.NET policy'si **deklaratif** (claim gereksinimi veri olarak okunur), Nest guard'ı **imperatif** koddur (`canActivate`). Guard'ın _ne kontrol ettiği_ statik olarak bilinemez. Bu yüzden Nest'te görünürlük filtresi için iki yol var (Faz 6'nın açık sorusu):

1. Arama anında guard'ı gerçekten koşmak: sentetik `ExecutionContext` ile `canActivate` çağrılır — ASP.NET'teki `IAuthorizationService` değerlendirmesinin karşılığı.
2. Deklaratif metadata varsa onu okumak: `@SetMetadata`/roles decorator'ları kullanan projelerde veri olarak çıkarılabilir.

Yaptırım tarafında Nest'te de sorun yok: replay'de üç seviyeyi de Nest kendisi uygular.

## Kaçış notu: resource-based yetki

"Kaynağa bakan" kontroller (ör. "sipariş sahibi mi?") her iki framework'te de **invoke anında** sorunsuz çalışır (controller kodu koşuyor) ama **listeleme anında** değerlendirilemez (ortada kaynak yok). Kural: böyle endpoint'ler aramada görünür, çağrıda gerekirse reddedilir. Görünürlük ≠ yaptırım ayrımının pratik sonucu.
