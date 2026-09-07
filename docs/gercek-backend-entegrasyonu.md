# Gerçek bir backend'e sk-mcp eklemek

Bu belge, yüzlerce endpoint'i olan, yıllardır yaşayan bir ASP.NET Core backend'ine `SkMcp.AspNetCore`'u eklerken karşılaşılan gerçek sorunları ve çözümlerini anlatır. Sıfırdan bir projede hızlı başlangıç için [sdks/dotnet/README.md](../sdks/dotnet/README.md) yeterlidir.

Buradaki ölçümlerin tamamı tek bir gerçek backend'den (motokurye, 718 endpoint, 25 controller) alınmıştır; uydurma sayı yoktur. Ayrıntı: [faz-3 notları](fazlar/faz-3-sema-ve-arama/notlar.md), [faz-4 notları](fazlar/faz-4-hata-cache-transport/notlar.md).

## 1. Paketle bağlayın, ProjectReference ile değil

`ProjectReference` restore sırasında hedef paketin **tüm** TFM'lerini değerlendirir. `global.json` ile eski bir SDK pinleyen bir host'ta bu, host'un hiç kullanmayacağı bir hedef yüzünden `NETSDK1045` verir. `SetTargetFramework` metadata'sı bunu çözmez — ölçüldü, çözmüyor.

Paket yolu bu sorunu yaşamaz: NuGet host'un SDK'sının kurabildiği varlığı seçer.

```bash
dotnet nuget add source /yol/sk-mcp/sdks/dotnet/local/nupkg-feed --name sk-mcp-local
dotnet add package SkMcp.AspNetCore --version 0.1.0-alpha.1
```

Alpha'yı yeniden paketlerken **sürüm son ekini artırın** (`alpha.2`, `alpha.3`). NuGet bir `id+version` çiftini bir kez çözdükten sonra değişmez sayar; aynı sürümü yeniden pack'lerseniz host `~/.nuget/packages/` altındaki eski kopyayı sessizce kullanmaya devam eder. Zorunda kalırsanız `dotnet nuget locals http-cache --clear` + o sürümün global paket klasörünü silin; `locals all --clear` yapmayın, backend'inizin tüm bağımlılıklarını yeniden indirtir.

## 2. Namespace çakışması

`0.1.0-alpha.1` öncesinde `SkMcp.AspNetCore` kök namespace'i `ParameterLocation` ihraç ediyordu ve `Microsoft.OpenApi.Models` de aynı adı taşıdığı için Swashbuckle kullanan bir host'ta `using SkMcp.AspNetCore;` satırı `CS0104 ambiguous reference` veriyordu. Bu SDK'nın kusuruydu; Swagger ASP.NET dünyasında istisna değil kuraldır.

Alpha'da düzeltildi: istek kompozisyonu tipleri `SkMcp.AspNetCore.Requests` altına taşındı, kalan iç tipler `internal` yapıldı. Kökte yalnız `AddSkMcp`/`UseSkMcpCapture`/`MapSkMcp`, `SkMcpOptions` ağacı, `IsSkMcpRequest()` ve sk-mcp istisnaları kaldı. Host tarafında tam nitelikli ad workaround'u gerekmiyor.

## 3. Seçim modu: büyük backend'de opt-out

Varsayılan `Selection.Default = Exclude`, yani `[McpTool]` ile işaretlenen açılır. 700 endpoint'te attribute yolu pratik değildir; tersine çevirin:

```csharp
builder.Services.AddSkMcp(options =>
{
    options.Selection.Default = SelectionDefault.Include;
    options.Synthetic.Scheme = "https";
    options.Visibility.Tier = VisibilityTier.Probe;
});
```

İstisnalar `[McpIgnore]` ile kapatılır.

## 4. Beklenecek katalog ölçeği

Bu bölümdeki sayılar aynı backend'in **iki ayrı** koşusundan geliyor; ayrı tutuluyorlar çünkü aralarında bir kural değişikliği var.

### Ölçüm A — canlı boot

Host'ta o sırada dört `[EndpointName]` çakışma workaround'u vardı:

```text
sk-mcp catalog: 718 discovered, 718 selected, 698 tools, 11 diagnostic(s)
```

| Ölçüm                                   | Değer |
| --------------------------------------- | ----- |
| ApiExplorer'ın gördüğü                  | 718   |
| Seçilen                                 | 718   |
| Üretilen tool                           | 698   |
| Fatal tanı                              | 0     |
| `unsupported_binding` (form gövdesi)    | 10    |
| `naming_policy_unresolved` (Newtonsoft) | 1     |
| `long_tool_name`                        | 0     |

10 + 1 = 11, boot satırındaki sayı. 24 container, 215 gövdeli, 390 path parametreli, 91 query parametreli, 0 header parametreli endpoint; 698/698 istek şablonu kuruldu.

İlk koşuda dört `name_collision` çıkmıştı ve `search_tools` fatal tanı yüzünden hata veriyordu: `delete` (Notification + PushProviderConfig), `list` (PushProviderConfig + WorkflowEndpoint), `create` (SupportRequest + WorkflowEndpoint), `get_status` (License + SqlStudio). Bunlar host'ta `[EndpointName]` ile çözülmüştü — yani ölçüm A'daki "çakışma yok" durumu host'un kod yazmasıyla satın alınmıştı.

### Ölçüm B — container prefix kuralı sonrası

Çakışma duvarı spec değişikliğine çevrildi: çakışmada her iki tarafa container'dan türetilen prefix eklenir. Doğrulamak için host'taki beş `[EndpointName]` **geri alındı** ve yeniden ölçüldü:

| Ölçüm            | Değer           |
| ---------------- | --------------- |
| Keşfedilen       | 718             |
| Üretilen tool    | 698             |
| `name_collision` | 0               |
| `long_tool_name` | 1 (66 karakter) |

Kural dört çakışmayı host'a tek satır yazdırmadan çözüyor; adlar `bpm_validate_definition`, `push_provider_config_list` gibi container'ını taşıyor. Ödenen bedel tek bir `long_tool_name` uyarısı — prefix, uzunluk tavanını 698 adın birinde zorluyor. Tavan uyarı seviyesinde olduğu için kabul edildi.

Sizin backend'inizde beklenecek olan **ölçüm B**'dir: çakışma için host'a kod yazdırmak gerekmez.

## 5. Görünürlük katmanı ve maliyeti

Deklaratif katman (`VisibilityTier.Declarative`, varsayılan) yetki metadata'sını okur; `Probe` ek olarak `unknown` kalanların ilk K'sını gerçekten koşturur.

Kimlik ve anonimlik üç değerlidir (`allow`/`deny`/`unknown`). Bu backend'de hiçbir endpoint `IAuthorizeData` taşımıyor ve fallback policy yok — yetki tamamen custom bir `JwtAuthenticationMiddleware`'de. Framework gözüyle hepsi anonim görünür. Kuralın ilk hali bunların 250'sini `allow` sayıp listeye koyuyordu: yaptırım açığı değil ama **liste kirliliği** — kimliksiz bir çağıran onları görüp invoke'da 401 alıyordu. Kural üç değerliye çevrildi, beyansız durum `unknown` oldu ve probe'a devredildi.

Ölçülen bedel dürüsttür:

| Kural                     | Arama süresi (50 kart) | `unknown` |
| ------------------------- | ---------------------- | --------- |
| Eski (beyansız → `allow`) | 1.180 ms               | 0         |
| Üç değerli + Probe açık   | 21.978 ms              | 664       |

Fark, eskiden probe'a hiç girmeyen 251 endpoint'in artık ilk 25'inin gerçekten koşulmasından geliyor. Bütçe kuralı doğru çalışıyor; pahalı olan bütçe içindeki her probe. Asıl darboğaz SDK değil, host'un kendi middleware'i — bu backend'de her istekte yeni bir NHibernate session açılıyor.

Ayarlar: `Visibility.ProbeTopK` (25), `Visibility.ProbeConcurrency` (4), `Cache.Lifetime` (30 sn), `Cache.MaxCallers` (128).

Probe'un sınırı: yetki beyanı taşımayan minimal API / route handler'lar probe edilemez (kesme noktası yok), `unknown` kalıp `authUncertain` ile gösterilir. Çıkış yolu SDK'ya değil framework'e yazılan tek satırdır: `.AllowAnonymous()`. Deklaratif yazan backend hiçbir maliyet ödemez.

## 6. Host tarafında yapılan değişiklikler

Bu backend'de SDK'ya hiç dokunulmadı; host tarafında yapılanlar şunlar:

- `AllowAnonymousAttribute : IAllowAnonymous` — host'un kendi attribute'u framework arayüzünü implement etmiyordu. Eklemek yalnız sk-mcp için değil, framework'ün kendi authz middleware'inin de saygı duyması için doğru.
- `AddSkMcp` yapılandırması: `Synthetic.Scheme = "https"`, `Selection.Default = Include`, `Visibility.Tier = Probe`.
- `UseSkMcpCapture()` ilk middleware, `MapSkMcp("/mcp")`.
- İki custom formatter'da `IsSkMcpRequest()` dalı. **`forceEncryption` da atlanmalı** — yoksa ajan şifrelenmiş çöp alır.

## 7. Kimlik taşıma

Varsayılan olarak yalnız `Authorization` taşınır ([karar 001](kararlar/001-kimlik-tasiyicilari.md)); taşıma default-deny'dir. Backend'iniz kimliği başka header'lardan da okuyorsa beyan edin:

```csharp
options.Identity.Forward("x-enrollment").Forward("X-PortalCode");
```

Hangi header'ın gerçekten gerektiğini varsaymayın, ölçün: bu backend'de `x-portalcode` bearer akışında hiç okunmuyordu.

`Identity.Project` ile dış istekten sentetik isteğe serbest projeksiyon yapılabilir. Projeksiyon dış istek dışında bir kaynaktan (saat, sayaç, veritabanı) değer türetiyorsa önbelleği kapatmayın — o kaynağı da özete katan bir `ICallerScopeResolver` yazın; `CarrierHashCallerScopeResolver.DigestInput`'u sarıp bir satır eklemek yeterlidir.

## 8. OAuth ve resource server

sk-mcp **asla** `AddAuthentication` çağırmaz ([karar 008](kararlar/008-tasima-ve-oauth.md)). Yaptırım host'un elindeki neyse odur — `JwtBearer`, custom middleware, ya da hiçbiri.

`ResourceServer.Metadata` verildiğinde RFC 9728 protected resource metadata'sı yayınlanır ve 401'ler `resource_metadata` ile dekore edilir. Bu ikisi, ASP.NET authentication'ı hiç kurulmamış bir backend'de bile çalışır. Tam OAuth akışı ancak backend'in önünde bir authorization server olduğunda koşulabilir.

## 9. Yetki değiştiğinde önbelleği geçersiz kılmak

`Cache.Lifetime` (30 sn) yetki değişiminin **maksimum yansıma gecikmesidir**. Anında yansıma için host kendi "izinler değişti" noktasını SDK'ya bağlar:

```csharp
await invalidator.InvalidateTagAsync($"user:{userId}", ct);
```

Etiketler `ICallerScopeResolver`'ın `CallerScope.Tags`'e yazdıklarıdır (`user:42`, `tenant:7`). SDK kullanıcı kimliğini bilmez, yalnız taşıyıcı özetini bilir; köprüyü host kurar. Otomatik bir bağlantı bilinçli olarak yoktur ([karar 006](kararlar/006-genisletme-noktalari.md)).

Görünürlük yaptırım değildir: geri alınan bir yetki önbellek ömrü içinde tool'u listede bırakabilir, ama `invoke_tool` yine 403 döner.

## 10. Tool'lar eksik geldiğinde: tanılar

Katalog kurulumu startup'ta tek satır log basar ve tanıları kod bazında listeler. Şiddet üç kademelidir: `Warning`, `EndpointDropped`, `Fatal`. Varsayılan `Diagnostics.FailOn = Fatal`, yani fatal bir tanı host'u açtırmaz.

Tekil kodları kaydırabilirsiniz:

```csharp
options.Diagnostics.Downgrade.Add("naming_policy_unresolved");
options.Diagnostics.Escalate.Add("unsupported_binding");
```

Beklenen ve zararsız iki kod: form gövdeli endpoint'ler için `unsupported_binding` (katalogdan düşer), Newtonsoft kullanan host'ta `naming_policy_unresolved`.

## 11. Şema hattı: neyi beklemelisiniz

Faz 6'da kapandı. Derinlik sınırı **kaldırıldı**: iç içe DTO ağaçları tamamen açılır ve sonlanmayı
`$defs` tablosu garanti eder. Döngüler ve birden fazla kullanılan tipler `$defs` + `$ref` ile ifade
edilir; aynı tipi iki üyede kullanan bir DTO artık şemayı iki kez yazmaz. Nesne olmayan gövde
kökleri (`[FromBody] List<int>`, `[FromBody] string`) artık düşürülmez, sentetik tek bir `body`
argümanına sarılır.

Pratikte iki şeye dikkat edin:

- **Genişlik.** Hoisting recursion'ı sınırlar, genişliği sınırlamaz: onlarca farklı
  tek-kullanımlık DTO tek bir büyük `inputSchema`'ya açılabilir. Bağlam bütçeniz sıkışırsa
  `options.Schema.MaxDepth` ile bir tavan koyabilirsiniz — default kapalıdır ve bir kural değil,
  host politikasıdır.
- **`$defs` anahtarları tip adlarınızın basit hâlidir.** Ada karışmak isterseniz
  `options.Schema.TypeName` ile yeniden adlandırın.

Okunamayan bir şekil (`object` tipli üye, decorator taşımayan DTO alanı) endpoint'i **düşürmez**:
sınır nesnesi (`additionalProperties: true`) yazılır, `unreadable_shape` uyarısı üretilir ve tool
zayıf sözleşmeyle çağrılabilir kalır. "Prod'da opak gövde olmasın" diyorsanız kodu
`options.Diagnostics.Escalate`'e ekleyin.
