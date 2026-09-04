# Karar 006 — Genişletme Noktaları

Tarih: 2026-09-02. Durum: **kabul edildi** — Faz 4 uygulaması bu kararı takip eder.

> Numaralandırma notu: bu kararlar sırayla 006/007/008 numaralarını taşır; 005 bu repoda ilgisiz, eşzamanlı bir çalışmaya (excel-mcp) ayrılmış durumdaydı.

## Cetvel

Karar 003'ün cetveli ("doğru cevap backend'den backend'e değişiyorsa politika → kod yazanın; tek doğru cevap varsa mekanik → SDK'nın, düğmesiz") Faz 4'te dört genişletme noktası ekliyor. Hangisinin nasıl kayıtlı olacağını belirleyen **nitelik kuralı**:

- **Değer biçimli politika** ("bu alan ne olsun") → option property, interface yok.
- **Kod biçimli politika** ("senin backend'inde bu nasıl türetilir": kimlik kaynağı, yetki gerçekleri, hata gövdesi tanıma) ya da **altyapı** ("state nerede yaşar") → interface + default implementasyon + `TryAdd`, çerçeve tablosunda ayrı satır.
- **Fixture/spec'in tek doğru cevap verdiği şeyler** (isimlendirme, şema dönüşümü, sıralama, katalog kurulumu, combiner, dispatch, meta-tool tel biçimi) → sealed; ezilmesi conformance'ı kırar.
- **Host'un çağırdığı ama değiştirmesi beklenmeyen operasyonlar** (invalidate, reload, change token) → "giriş noktası", tabloda ayrı satır.

Her yeni nokta test çarpanı + doküman + NestJS eşleniği + fixture maliyeti taşır (karar 003) — bu yüzden liste kapalıdır: aşağıdaki altı satırın dışına yeni bir genişletme noktası talep kanıtlanmadan eklenmez.

## dotnet çerçeve tablosu (Faz 4 sonu)

| Nokta                                               | Default                                    | Sorumluluk                                  | Ne zaman ezilir                                                                                             |
| --------------------------------------------------- | ------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `IVisibilityEvaluator` (var)                        | `DeclarativeVisibilityEvaluator`           | T1: bir çağıran için `CallerFacts`          | Yetki, ASP.NET policy'siyle ifade edilmiyorsa                                                               |
| `IProbeEvaluator` (var; artık cache'siz)            | `ProbeEvaluator`                           | T2: bir entry için önbelleksiz verdict      | Farklı bir probe stratejisi gerekiyorsa                                                                     |
| `ICallerScopeResolver` (yeni)                       | `CarrierHashCallerScopeResolver`           | Dış istek → `CallerScope(Key, Tags)`        | Kimlik, beyan edilen taşıyıcılarda yaşamıyorsa; hedefli geçersiz kılma için tag/tenant anahtarı gerekiyorsa |
| `ISkMcpCache` (yeni)                                | `MemorySkMcpCache`                         | Scope'lu, tag'li, TTL'li depo               | Çok instance'lı dağıtım (Redis adaptörü)                                                                    |
| `IInvokeResultMapper` (yeni, hata iş akışı)         | `InvokeResultMapper` (zincir)              | HTTP yanıtı → `InvokeSuccess`/`MappedError` | Backend'e özgü bir zarf ya da ham çıktı isteniyorsa                                                         |
| `IProtectedResourceMetadataProvider` (yeni, taşıma) | `OptionsProtectedResourceMetadataProvider` | RFC 9728 PRM dokümanı                       | Çok-tenant / dinamik authorization-server-scope kurulumları                                                 |

Delegate biçimli küçük hook'lar (mevcut stille aynı): `options.Errors.Recognize(ErrorRecognizer)` (mapper zincirinin önüne koşar — [karar 007](007-hata-eslemesi.md)), var olan `Identity.Project`, `Naming.Prefix`, `Schema.PropertyName`.

**Giriş noktaları** (host çağırır, değiştirmez): `ISkMcpCacheInvalidator` (`InvalidateCallerAsync`/`InvalidateTagAsync`/`InvalidateAllAsync`), `ISkMcpCatalogChangeSource { long Generation; IChangeToken GetChangeToken(); ValueTask ReloadAsync(CancellationToken); }`.

`ReloadAsync` Faz 5'te bu arayüze taşındı. Önce yalnız `SkMcpCatalogProvider` üzerinde duruyordu; o sınıf aşağıdaki "sealed kalanlar" listesinde olduğu için alpha'da `internal` yapılınca host giriş noktasını çağıramaz hale gelmişti. Giriş noktası arayüzde, tesisat sınıfta.

## Nest `ExtensionPoints`

Faz 4 sonu itibarıyla dört nokta: `cache: SkMcpCache`, `callerScopeResolver: CallerScopeResolver`, `invokeResultMapper: InvokeResultMapper`, `sessionStore: SkMcpSessionStore`. Faz 6'da meta-tool'lar Nest'e geldiğinde `visibilityEvaluator`/`probeEvaluator` eklenir — dotnet tablosuyla eşitlenir.

```ts
interface ExtensionPoints {
  cache: SkMcpCache;
  callerScopeResolver: CallerScopeResolver;
  invokeResultMapper: InvokeResultMapper;
  sessionStore: SkMcpSessionStore;
}

const extensionTokens = {
  cache: Symbol("SK_MCP_CACHE"),
  callerScopeResolver: Symbol("SK_MCP_CALLER_SCOPE_RESOLVER"),
  invokeResultMapper: Symbol("SK_MCP_INVOKE_RESULT_MAPPER"),
  sessionStore: Symbol("SK_MCP_SESSION_STORE"),
} as const satisfies { readonly [K in keyof ExtensionPoints]: symbol };

type ExtensionOverrides = Partial<{
  [K in keyof ExtensionPoints]: OverrideProvider<ExtensionPoints[K]>;
}>;
```

`extensionTokens`'ın `satisfies` kısıtı, `ExtensionPoints`'e yeni bir nokta eklenip token'ı unutulursa derlemeyi kırar — yeni bir genişletme noktası eklemenin unutulması yapısal olarak imkânsız hale gelir. `SkMcpModule.forRoot(configure?, overrides?)` ve `forRootAsync({ imports, inject, useFactory, overrides })` bu `overrides`'ı kabul eder; `toProviders(overrides)` her zaman default provider'lardan **sonra** eklenir (Nest'in son-kazanır DI kuralı, MS DI'nin `TryAdd` semantiğiyle aynı sonucu üretir — aşağıya bkz).

## Sealed kalanlar

Fixture/spec'in tek doğru cevap verdiği, ezilmesi conformance'ı kıran parçalar: `SkMcpCatalogProvider`, `SkMcpDispatcher`, `SyntheticRequestFactory`, `ToolIndex`, `RequestComposer`, `ToolDefinitionFactory`, `ToolNameFactory`, `VisibilityCombiner`, `EndpointCatalog`, `SkMcpMetaTools`, `CallerVisibilityProvider`.

## Kayıt kuralı (TryAdd sırası)

`AddSkMcp` içinde her kayıt `TryAdd*`'dir. `SkMcpRegistrationMarker` ile idempotenttir: ikinci `AddSkMcp` çağrısı yalnız `Configure` katmanlarını üst üste bindirir, servisleri yeniden kaydetmez. `AddOptions<SkMcpOptions>().ValidateOnStart()` + `SkMcpOptionsValidator : IValidateOptions<SkMcpOptions>` başlangıçta patlar. `TimeProvider.System` `TryAdd` ile kayıtlıdır (testlerde `ManualTimeProvider` ile değiştirilir).

`TryAdd*` semantiğinin doğal sonucu: **host `AddSkMcp`'den önce ya da sonra kendi implementasyonunu kaydetsin fark etmez** — `TryAdd` yalnız hiç kayıt yoksa ekler, dolayısıyla ilk kazanan kalıcıdır ve sıra host lehine çalışır. Nest tarafında aynı sonuç `toProviders(overrides)`'ın default'lardan sonra eklenmesiyle (son-kazanır) elde edilir; iki farklı DI mekaniği aynı davranışa varır.

## Bilinçli eklenmeyen

- **Genel bir "hepsini ez" hook'u yok.** Her genişletme noktası kendi adı ve tipiyle ayrı kayıtlıdır — [karar 003](003-istek-ustverisi.md)'ün genel `Customize(outer, synthetic)` hook'unu reddetme gerekçesiyle aynı: tek amaçlı, adlandırılmış nokta hem test edilebilir hem host'un neyi değiştirdiğini dokümantasyondan okunur kılar.
- **Nest'te `visibilityEvaluator`/`probeEvaluator` Faz 4'te yok** — meta-tool'lar henüz Nest'te yaşamıyor (Faz 6). Erken eklemek karşılığı olmayan bir yüzeyi genişletmek olurdu.
- **`ISkMcpCacheInvalidator`'ı ezme yolu yok** — sealed facade'dir (`Bump()` epoch guard'ı + ilgili `ISkMcpCache` çağrısı); değiştirilecek olan depo (`ISkMcpCache`), invalidator'ın kendisi değil.
