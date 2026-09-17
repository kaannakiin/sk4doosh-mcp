# Sk4doosh MCP — Kullanıcı Bağlantıları ve Yetkilendirme Mimarisi

**Durum:** Tasarım / implementasyon yol haritası  
**Tarih:** 14 Eylül 2026  
**Odak:** Minimum entegrasyon eforu + güvenli kullanıcı eşleştirme + tekrar kullanılabilir bağlantılar  
**Kapsam:** `products/chat`, NestJS SDK, ASP.NET Core SDK ve partner onboarding akışı

---

## 1. Hedef

Sk4doosh'ta iki farklı ilişkiyi birbirinden ayırmak istiyoruz:

1. **Partner backend entegrasyonu**
   - Bir firma kendi backend'ini SDK ile MCP'ye açar.
   - CLI / SDK üzerinden araç sözleşmesini ve bağlantı bilgisini platforma tanıtır.
   - Bu işlem, firmanın kullanıcıları adına işlem yapma yetkisi vermez.

2. **Son kullanıcı bağlantısı**
   - Sk4doosh'a giriş yapmış bir kullanıcı, ilgili firma sistemindeki kendi hesabını bağlar.
   - Kullanıcı yalnızca izin verdiği erişimleri Sk4doosh'a devreder.
   - Bağlantı sohbet oturumuna değil kullanıcı hesabına bağlıdır ve yeni sohbetlerde tekrar kullanılabilir.

Ana hedef:

> Partner geliştirici mümkün olan en az auth kodunu yazsın; son kullanıcı mümkünse yalnızca bir kez **Bağla → İzin ver → Devam et** akışını görsün. Token, parola ve kimlik eşleştirme hiçbir zaman modelin sorumluluğu olmasın.

---

## 2. Mevcut ürünle sınır

`products/chat` tarafındaki mevcut Google/GitHub OAuth akışı **Sk4doosh hesabına giriş / hesap bağlama** işidir.

Yeni tasarlanacak sistem farklıdır:

```text
Sk4doosh Login
    "Bu kişi Sk4doosh'ta kim?"

Integration Connection
    "Bu Sk4doosh kullanıcısı, ÖrnekERP'de hangi hesap ve izinlerle işlem yapabilir?"
```

Bu iki kavram aynı OAuth yardımcılarını kullanabilir, fakat aynı veri modeli ve aynı token deposu olarak ele alınmamalıdır.

```text
Mevcut login:
Sk4doosh User
    ↓
Google / GitHub identity

Yeni bağlantı:
Sk4doosh User
    ↓
Integration Connection
    ↓
Firma MCP / API
    ↓
Firma kullanıcısı + erişim grant'i
```

---

## 3. Temel nesneler

### 3.1 Integration

Bir partner backend'inin platformdaki tanımıdır.

```text
id                  integration_systemsoft
slug                systemsoft
displayName         System Yazılım
mcpUrl              https://api.system.com/mcp
authMode            oauth
status              active
manifestVersion     12
```

Integration kullanıcıya ait değildir. Bir firma bir kez integration yayınlar; birçok kullanıcı aynı integration üzerinde ayrı bağlantılar oluşturabilir.

### 3.2 Connection

Bir **Sk4doosh kullanıcısının belirli bir integration üzerindeki yetkili bağlantısıdır.**

```text
id                  conn_123
userId              sk_user_42
integrationId       integration_systemsoft
providerSubject     usr_887
providerTenant      company_12
status              active
createdAt           ...
lastUsedAt          ...
```

```text
Kaan  → conn_123 → System Yazılım
Ayşe  → conn_987 → System Yazılım
```

Kaan'ın bağlantısı Ayşe tarafından kullanılamaz.

### 3.3 ConnectionGrant

Bağlantının Sk4doosh'a verdiği erişimi temsil eder.

```text
connectionId
scopes:
  - orders.read
  - customers.read
```

Bu izinler agent'a gösterilen endpoint listesi değildir.

```text
orders.read
    ├── list_orders
    ├── get_order
    └── search_orders
```

Kullanıcıya anlaşılır izinler gösterilir; geliştirici bunları tool'lara eşler.

### 3.4 Credential

Access token, refresh token, API key veya PAT gibi gizli materyaldir.

```text
Connection
    ↓
Credential reference
    ↓
Encrypted credential storage
```

Kurallar:

- Model credential göremez.
- Tool schema credential içermez.
- Chat mesajına credential yazılmaz.
- Normal uygulama loguna credential yazılmaz.
- Credential'ın hangi integration için üretildiği bilinmelidir.
- Credential model tarafından verilen keyfi bir URL'ye gönderilmemelidir.

---

## 4. Desteklenecek üç bağlantı seviyesi

Amaç tek bir auth türünü herkese zorlamak değil, **en güvenli ve en az eforlu yolu varsayılan yapmak**.

### Seviye 1 — Standart OAuth / OIDC

**Önerilen ve birinci sınıf yol.**

Partner uygun OAuth/OIDC yetkilendirme altyapısı sunuyorsa Sk4doosh bunu kullanır.

Kullanıcı deneyimi:

```text
System Yazılım
[ Hesabımı bağla ]

        ↓

System Yazılım yetkilendirme ekranı

Sk4doosh şunlara erişmek istiyor:

✓ Siparişleri görüntüleme
✓ Müşterileri görüntüleme

[ İzin ver ]

        ↓

✓ Hesabın bağlandı
```

Backend akışı:

```text
POST /connections/:integration/start
        ↓
ConnectionAttempt oluştur
        ↓
Authorization URL
        ↓
Provider login + consent
        ↓
GET /connections/callback
        ↓
state / issuer / PKCE kontrolü
        ↓
authorization code → token
        ↓
Connection + grant + credential oluştur
```

Tercih edilen güvenlik özellikleri:

- Authorization Code
- PKCE (`S256`)
- sağlayıcı destekliyorsa OIDC ile kalıcı hesap kimliği
- refresh token varsa güvenli yenileme
- revocation varsa bağlantı kaldırmada kullanma

---

## 5. Seviye 2 — SDK-assisted delegated auth

Birçok partnerde gerçek durum şu olacaktır:

```text
/login
    ↓
JWT

JwtAuthGuard
CurrentUser
Roles / permissions
```

Ama tam OAuth authorization server yoktur.

Bu firmalara "OAuth öğren, sıfırdan authorization server yaz" demek onboarding'i zorlaştırır.

Bunun yerine SDK'nın mevcut auth sisteminin üzerine ince bir **delegation adapter** eklemesi önerilir.

```text
Mevcut firma login sistemi korunur.
             +
Sk4doosh'a verilen ayrı erişim tanımlanır.
```

Partner geliştiriciden kavramsal olarak üç bilgi isteriz:

```text
1. Bu kullanıcı kim?
2. Bu bağlantının hangi yetkileri var?
3. Bu erişimin yaşam döngüsü nasıl doğrulanır / yenilenir / iptal edilir?
```

Önerilen extension point isimleri yalnızca tasarım örneğidir:

```text
UserIdentityResolver
ConnectionGrantResolver
CredentialIssuer / DelegationProvider
```

Bunların mevcut SDK API'si olduğu varsayılmamalıdır.

---

## 6. Seviye 3 — API key / PAT / custom credential

Bazı backend'lerde OAuth bulunmayacaktır.

```text
Authentication

○ OAuth
○ Personal Access Token
○ API Key
○ Custom Adapter
```

Kurallar:

- Firma kullanıcı parolası Sk4doosh tarafından toplanmaz.
- Credential modele verilmez.
- Credential kullanıcı bağlantısına bağlıdır.
- Credential yalnızca kayıtlı integration hedefine gönderilir.
- Mümkün olduğunda kullanıcıya credential'ın yetkileri gösterilir.
- Bu yol OAuth yolundan daha düşük UX sağlayabilir; bunu gizlemeyiz.

---

## 7. Firma entegrasyonu ile kullanıcı bağlantısını ayır

### Aşama A — Integration Registration

Partner geliştiricisi bir kez yapar.

```text
sk-mcp publish

System Yazılım
MCP URL: https://api.system.com/mcp
Tools: 42
Auth: OAuth
Manifest: v12
```

Bu işlem:

```text
"System Yazılım Sk4doosh'ta kullanılabilir."
```

anlamına gelir.

Şu anlama gelmez:

```text
"Sk4doosh artık bütün System Yazılım kullanıcıları adına işlem yapabilir."
```

### Aşama B — User Connection

Her son kullanıcı kendisi için yapar.

```text
Kaan → System Yazılım hesabını bağla
Ayşe → System Yazılım hesabını bağla
```

```text
Integration
  System Yazılım

Connections
  Kaan → usr_123 → orders.read
  Ayşe → usr_882 → orders.read + orders.manage
```

---

## 8. Connection kullanıcı deneyimi

Bağlantı sohbet içinde başlatılabilir:

```text
Kullanıcı:
"System Yazılım'daki son siparişlerimi getir."

Assistant:
"System Yazılım hesabın henüz bağlı değil."

[ Hesabımı bağla ]
```

OAuth dönüşünden sonra:

```text
✓ System Yazılım hesabın bağlandı.

Verilen erişim:
- Siparişleri görüntüleme
- Müşterileri görüntüleme
```

Bağlantı **chat session'a ait olmamalıdır**:

```text
Yanlış:
ChatSession → OAuth Token

Önerilen:
User → Connection → Credential
             ↑
          Chat kullanır
```

İleride aynı entegrasyonda çoklu hesap desteği eklenebilir; ilk sürümde tek aktif kişisel connection yeterli olabilir.

---

## 9. Scope modeli

Kullanıcıya onlarca endpoint gösterilmemelidir.

SDK geliştiricisi machine-level izinleri iş gruplarına eşler:

```text
orders.read
orders.manage
customers.read
customers.manage
reports.read
```

Örnek eşleme:

```text
orders.read
    ├─ list_orders
    ├─ get_order
    └─ search_orders

orders.manage
    ├─ create_order
    ├─ update_order
    └─ cancel_order
```

Kullanıcının gördüğü:

```text
System Yazılım erişimi

✓ Siparişleri görüntüleme
✓ Müşterileri görüntüleme
○ Sipariş oluşturma ve değiştirme
○ Müşteri bilgilerini değiştirme
```

Temel kural:

```text
effective permission
    =
provider'ın verdiği erişim
∩
connection'a verilen erişim
∩
platform politikası
```

Platform provider'ın verdiğinden daha geniş yetki üretemez.

---

## 10. Invocation authorization

Tool görünürlüğü bir güvenlik bariyeri değildir.

Bir araç `search_tools` sonucundan gizlense bile biri doğrudan adını biliyorsa `invoke_tool` üzerinden çağırmayı deneyebilir.

Bu nedenle kontrol **çalıştırma anında** yapılmalıdır.

```text
Model tool çağrısı önerir
        ↓
Tool bulunur
        ↓
Argüman doğrulanır
        ↓
User Connection bulunur
        ↓
Connection ownership kontrolü
        ↓
Connection status kontrolü
        ↓
Gerekli scope kontrolü
        ↓
Varsa işlem onayı kontrolü
        ↓
Credential çözülür / yenilenir
        ↓
MCP çağrısı yapılır
        ↓
Partner backend kendi authorization kurallarını tekrar uygular
```

Örnek:

```text
Kaan backend'de admin.

Connection:
  orders.read

Tool:
  cancel_order → orders.manage

Sonuç:
  Platform dispatcher'a geçmeden reddeder.
```

İki kontrol birbirini tamamlar:

```text
Sk4doosh:
"Kullanıcı bu erişimi chat'e verdi mi?"

Partner backend:
"Kullanıcı gerçekten bu siparişte bu işlemi yapabilir mi?"
```

---

## 11. Tool onayı ile connection iznini ayır

```text
Connection permission:
"Sk4doosh sipariş iptal etme yetkisine sahip olabilir."

Per-action approval:
"Şu 4821 numaralı siparişi şimdi iptal edeyim mi?"
```

İzin olması, hassas bir işlemin otomatik çalışması gerektiği anlamına gelmez.

Kullanıcı onay verse bile connection'da gerekli scope yoksa işlem çalışmamalıdır.

---

## 12. Partner onboarding — hedef deneyim

### 12.1 CLI auth inspect

Önerilen CLI deneyimi:

```bash
sk-mcp auth inspect
```

NestJS örneği:

```text
Framework          NestJS
Authentication     JWT bearer detected
Guard              JwtAuthGuard
Identity           CurrentUser decorator detected
OAuth server       Not detected

Recommended setup
  SDK-assisted delegated authorization

Next:
  sk-mcp auth setup
```

ASP.NET örneği:

```text
Framework          ASP.NET Core
Authentication     Bearer
Authorization      Policies detected
Identity           HttpContext.User
OAuth server       Detected

Recommended setup
  Standard OAuth connection
```

Amaç geliştiriciyi RFC okumaya zorlamak değil; SDK'nın mevcut sistemi anlayıp eksik parçayı göstermesidir.

### 12.2 CLI auth setup

```bash
sk-mcp auth setup
```

Örnek çıktı:

```text
We can reuse:

✓ JwtAuthGuard
✓ CurrentUser
✓ OrdersReadPolicy

Missing:

! Delegated connection grant

Implement one adapter:
  ConnectionGrantProvider
```

Bu komutların isimleri nihai API kararı değildir; ürün deneyimini anlatır.

---

## 13. Manifest'e auth capability eklemek

CLI'ın platforma verdiği manifest yalnızca tool bilgisi taşımamalıdır.

OAuth örneği:

```json
{
  "integration": {
    "name": "System Yazılım",
    "mcpUrl": "https://api.system.com/mcp"
  },
  "auth": {
    "mode": "oauth",
    "resource": "https://api.system.com/mcp",
    "accountLinking": true
  }
}
```

Legacy:

```json
{
  "auth": {
    "mode": "personal_token",
    "accountLinking": true
  }
}
```

SDK-assisted:

```json
{
  "auth": {
    "mode": "delegated_adapter",
    "accountLinking": true
  }
}
```

Secret veya private key manifest içine konmaz.

---

## 14. Platform servis sınırları

İlk sürümde bunların mikroservis olması gerekmez.

### IntegrationRegistry

```text
Integration'ı bul
Manifest'i oku
MCP URL'ini belirle
Auth capability bilgisini taşı
```

### ConnectionService

```text
User + Integration bağlantısını oluştur
Aktif bağlantıyı getir
Ownership kontrolü
Disable / reconnect
```

### OAuthConnectionService

Mevcut `OAuthService` ile aynı şey değildir.

```text
Mevcut OAuthService
→ Sk4doosh login

Yeni OAuthConnectionService
→ dış integration hesabı bağlama
```

Ortak düşük seviyeli OAuth yardımcıları paylaşılabilir.

### CredentialStore

```text
Credential sakla
Credential getir
Credential yenile
Credential sil
```

Uygulama katmanı mümkünse gerçek token yerine credential reference taşır.

### InvocationAuthorizer

```text
Bu user,
bu connection üzerinden,
bu tool'u çalıştırabilir mi?
```

Kavramsal kontrat:

```text
authorize({
  user,
  connection,
  integration,
  tool,
  arguments
})
    → allow / deny
```

Bu API yalnızca tasarım önerisidir.

### McpConnectionClient

```text
Doğru integration
+
doğru connection credential
+
MCP transport
```

birleştirilir.

Model bu katmana token sağlamaz.

---

## 15. Önerilen veri modeli

İlk sürüm için minimum:

```text
Integration
Connection
ConnectionScope
CredentialReference
ConnectionAttempt
```

### Integration

```text
id
slug
displayName
mcpUrl
authMode
manifestVersion
status
```

### Connection

```text
id
userId
integrationId
providerSubject?
providerTenant?
status
credentialRef?
createdAt
lastUsedAt
revokedAt?
```

İlk sürümde:

```text
unique(userId, integrationId)
```

İleride çoklu hesap gerekiyorsa genişletilebilir.

### ConnectionScope

```text
connectionId
scope
```

### ConnectionAttempt

Kısa ömürlüdür.

```text
id
userId
integrationId
stateHash
pkceVerifierRef
expiresAt
returnTo
status
```

Callback'ten gelen serbest `userId` bağlantı sahipliği için kullanılmaz.

---

## 16. OAuth bağlantı akışı

### Start

```text
Authenticated Sk4doosh user

POST /integrations/:id/connect
```

Backend:

```text
1. User kimliğini mevcut Sk4doosh session'dan al.
2. Integration'ı getir.
3. ConnectionAttempt oluştur.
4. state üret.
5. PKCE verifier/challenge üret.
6. Authorization URL döndür.
```

### Callback

```text
GET /integrations/oauth/callback
```

Backend:

```text
1. state üzerinden ConnectionAttempt bul.
2. Süre dolmuş mu kontrol et.
3. Provider / integration eşleşiyor mu kontrol et.
4. Issuer doğrula.
5. Authorization code'u PKCE verifier ile değiştir.
6. Provider hesabı güvenilir biçimde belirlenebiliyorsa kaydet.
7. Scope/grant bilgisini kaydet.
8. Credential'ı güvenli depoya yaz.
9. Connection'ı active yap.
10. Attempt'i consumed yap.
```

Callback URL'deki serbest `userId` bağlantı eşleştirmesinin kaynağı olamaz.

---

## 17. Token yaşam döngüsü

İlk bağlantıdan sonra hedef UX:

```text
Kullanıcı her sohbet açtığında tekrar login olmaz.
```

Ancak:

```text
refresh başarısız
grant iptal edilmiş
provider güvenlik nedeniyle erişimi sona erdirmiş
```

ise connection:

```text
reauth_required
```

durumuna alınabilir.

UI:

```text
System Yazılım bağlantının yeniden doğrulanması gerekiyor.
[ Yeniden bağla ]
```

---

## 18. Disconnect

```text
Ayarlar
→ Bağlantılar
→ System Yazılım
→ Bağlantıyı kaldır
```

Platform:

```text
1. Connection'ı inactive/revoked yap.
2. Yeni invoke çağrılarını engelle.
3. Refresh denemelerini durdur.
4. Provider revocation destekliyorsa revoke çağrısı yap.
5. Credential'ı güvenli biçimde kaldır.
```

Sadece yerel token'ı silmek, provider tarafındaki grant'in kesin olarak iptal edildiği anlamına gelmez.

---

## 19. Hata modeli

Connection hatalarını normal tool hatalarından ayır.

```text
connection_required
connection_expired
connection_revoked
insufficient_connection_scope
reauth_required
provider_unavailable
```

Bunlar iş API'si hatalarından farklıdır:

```text
validation_failed
not_found
conflict
```

Örnek:

```text
reauth_required
    → [Hesabı yeniden bağla]

validation_failed
    → Model argümanı düzeltebilir.
```

---

## 20. Güvenlik invariant'ları

1. Token model bağlamına girmez.
2. Model `Authorization` header'ı üretmez.
3. Model connection sahibini belirlemez.
4. `connectionId` verilmesi ownership kanıtı değildir.
5. Her invoke bağlantı sahibini güvenilir Sk4doosh session'ından doğrular.
6. Connection scope çalıştırma anında kontrol edilir.
7. Tool görünürlüğü güvenlik sınırı değildir.
8. Provider backend'in kendi authorization'ı kaldırılmaz.
9. OAuth reddedildiğinde daha geniş bir legacy JWT'ye otomatik fallback yapılmaz.
10. Credential kayıtlı integration dışındaki hedefe gönderilmez.
11. Integration publish credential'ı kullanıcı işlemi yapma credential'ı değildir.
12. Connection silinince yeni işlem başlatılamaz.
13. OAuth callback kullanıcıyı URL'den gelen serbest bir kimlikle eşleştirmez.
14. Refresh token rotation/reuse davranışı sağlayıcının güvenlik modeline uygun uygulanır.

---

## 21. Implementasyon fazları

### Faz 1 — Integration + Connection domain modeli

Önce OAuth yazma.

Eklenmesi gereken kavramlar:

```text
Integration
Connection
ConnectionScope
ConnectionAttempt
```

Tamamlanma kriteri:

```text
Kaan için integration A bağlantısı oluşturulabilir.
Ayşe Kaan'ın connection'ını okuyamaz/kullanamaz.
Connection chat session'dan bağımsızdır.
```

### Faz 2 — Invocation authorization

Gerçek OAuth'tan önce kontrol katmanını kur.

```text
Kaan:
  backend role = admin

Connection:
  orders.read

Tool:
  cancel_order requires orders.manage

Beklenen:
  dispatcher çalışmaz.
```

Bu faz fake credential/grant ile tamamen test edilebilir.

> OAuth daha sonra yalnızca "connection'a gerçek credential ve scope nasıl geliyor?" problemini çözer.

### Faz 3 — Standart OAuth connection

Tek bir demo provider/integration ile şunları tamamla:

```text
connect
callback
token storage
refresh
reauth_required
disconnect
```

Mevcut Google/GitHub login OAuth kodundan ortak OAuth primitive'leri çıkarılabilir; fakat iki domain birleşmez.

### Faz 4 — MCP client'ı Connection-aware yap

Şu anki internal reader MCP bağlantılarından ayrı remote integration yolu eklenir.

```text
toolsFor(userId)
    ↓
aktif integration connections
    ↓
connection-specific MCP clients/tools
```

Credential kullanıcıya bağlıysa istemci/cache güvenlik sınırı en az `connectionId` olmalıdır.

### Faz 5 — Scope → tool mapping

Partner tarafı:

```text
get_order:
  permission: orders.read

cancel_order:
  permission: orders.manage
```

yayınlayabilsin.

`search_tools`, `load_tool` ve `invoke_tool` aynı connection bağlamını kullanır; güvenlik açısından nihai kontrol `invoke_tool` öncesidir.

### Faz 6 — SDK-assisted delegated auth

OAuth altyapısı olmayan partnerlere adapter modeli eklenir.

NestJS ve ASP.NET Core örnekleri hazırlanır.

Hedef partner işi:

```text
birkaç config
+
bir adapter
```

seviyesinde kalmalıdır.

### Faz 7 — CLI onboarding

```text
sk-mcp auth inspect
sk-mcp auth setup
sk-mcp publish
```

CLI geliştiriciye mevcut auth'ı, eksik parçayı ve önerilen yolu gösterir.

### Faz 8 — PAT / API key compatibility

OAuth ve delegated adapter oturduktan sonra ekle.

Aksi takdirde legacy yol kolay olduğu için ürün farkında olmadan onun etrafında şekillenebilir.

### Faz 9 — Revocation, audit ve recovery

```text
disconnect
token revocation
refresh rotation
reauth
audit trail
provider outage
race conditions
duplicate callback
expired callback
```

---

## 22. İlk kod görevi

İlk implementasyon OAuth değildir.

Test 1:

```text
Given:
  Kaan authenticated in Sk4doosh
  Kaan has connection conn_1
  conn_1 belongs to Integration SystemSoft
  conn_1 grants only orders.read

When:
  invoke_tool(cancel_order)

Then:
  request is rejected before MCP/backend dispatch
```

Test 2:

```text
Given:
  conn_1 belongs to Kaan

When:
  Ayşe calls invoke using conn_1

Then:
  connection_not_found / forbidden
  credential is never resolved
```

Test 3:

```text
Given:
  conn_1 is revoked

When:
  Kaan invokes any remote tool

Then:
  invocation is rejected
  refresh is not attempted
```

Bu üç test auth mimarisinin omurgasını oluşturur.

---

## 23. Partner dokümantasyonu için örnek yol

İlk ekran:

```text
Choose how users authenticate

Recommended
[ OAuth / OIDC ]

Already have JWT/session auth?
[ Use the Sk4doosh delegation adapter ]

Using personal credentials?
[ API key / PAT ]
```

OAuth:

```text
1. MCP resource URL'ini belirt.
2. Authorization server bilgisini doğrula.
3. Scope → tool eşlemesini tanımla.
4. sk-mcp auth test çalıştır.
5. publish.
```

Delegated adapter:

```text
1. Existing identity resolver'ı seç.
2. Delegated grant adapter'ını ekle.
3. Scope → tool eşlemesini tanımla.
4. sk-mcp auth test çalıştır.
5. publish.
```

---

## 24. İlk sürüm kapsam dışı

İlk sürümde zorunlu yapma:

- Organizasyon yöneticisinin ekip adına ortak connection paylaşması.
- Bir integration için sınırsız sayıda hesap profili.
- Cross-user credential delegation.
- Service-account + user impersonation kombinasyonları.
- Background autonomous işlemler için ayrı offline policy sistemi.
- Marketplace billing.
- Kendi genel amaçlı identity provider'ını sıfırdan yazmak.

Önce kişisel connection akışını sağlamlaştır.

---

## 25. Başarı kriteri

```text
1. Kaan Sk4doosh'a mevcut login sistemiyle girer.
2. System Yazılım integration'ını seçer.
3. "Hesabımı bağla" der.
4. Firma tarafında authenticate olur.
5. Sadece sipariş okuma izni verir.
6. Connection Kaan'a kaydedilir.
7. Yeni bir chat açar.
8. "Son siparişlerimi getir" çalışır.
9. "4821 numaralı siparişi iptal et" çalışmaz.
10. Ayşe Kaan'ın bağlantısını kullanamaz.
11. Kaan connection'ı kaldırır.
12. Sonraki bütün çağrılar durur.
13. Token hiçbir aşamada modele verilmez.
```

Bu senaryo geçmeden ikinci auth modeline geçilmemesi önerilir.

---

## 26. Mevcut repo ile eşleştirme

Korunabilecek ayrımlar:

```text
products/chat/api/src/auth/*
    → Sk4doosh account authentication

products/chat/api/src/mcp/*
    → MCP client/runtime tarafı

sdks/nestjs/*
sdks/dotnet/*
    → Partner backend integration
```

Yeni önerilen mantıksal alanlar:

```text
products/chat/api/src/integrations/*
products/chat/api/src/connections/*
```

Örnek:

```text
integrations/
  integration-registry.service.ts

connections/
  connection.service.ts
  connection.repository.ts
  connection-attempt.service.ts
  oauth-connection.service.ts
  credential-store.ts
  invocation-authorizer.ts
```

Dosya isimleri bağlayıcı karar değildir; amaç mevcut login auth ile external integration auth'ın modül sınırını korumaktır.

---

## 27. Karar özeti

- **Sk4doosh login** ayrı kalır.
- **Partner integration registration** bir kez yapılır.
- **User connection** her kullanıcı için ayrı kurulur.
- Bağlantı sohbetten bağımsız ve tekrar kullanılabilirdir.
- OAuth/OIDC ana yol olur.
- Mevcut JWT/session backend'leri için SDK-assisted adapter sunulur.
- API key/PAT compatibility yolu olarak desteklenebilir.
- Token modele verilmez.
- Tool görünürlüğü güvenlik kontrolü sayılmaz.
- Nihai connection yetkisi her invoke çağrısında kontrol edilir.
- Firma backend'inin mevcut authorization'ı korunur.
- Partner onboarding'i CLI ile mümkün olduğunca otomatikleştirilir.

En önemli ürün ilkesi:

> **Güvenlik kontrollerini kaldırarak UX iyileştirmiyoruz; doğru varsayılanlar, keşif ve otomasyonla güvenlik detaylarını geliştirici ve son kullanıcı için mümkün olduğunca görünmez hale getiriyoruz.**

---

## 28. F1 ile kesinleşen kararlar

İlk implementasyon dilimi (`authorizeInvocation` çekirdeği) sırasında verilen, bu belgenin önceki bölümlerini bağlayan kararlar.

### 28.1 Bağlantı numarası invoke sözleşmesinin parçası değil

Çağıran bağlantıyı `(sessionUserId, integrationId)` ile yükler; model hiçbir zaman bir `connectionId` söylemez. Bölüm 15'teki `unique(userId, integrationId)` bunu zaten mümkün kılıyor. Sahiplik kontrolü yine de yetkilendiricinin içinde kalır, ama tek bariyer değil ikinci bariyerdir.

İleride aynı entegrasyonda çoklu hesap gerekirse imza genişletilir; o güne kadar "ödünç alınmış bağlantı numarası" saldırı yüzeyi hiç var olmaz.

### 28.2 `connection_expired` kaldırıldı

Bölüm 19'daki hata listesinden çıkarıldı; `reauth_required` ile birleşti. İkisi de tek bir "Yeniden bağla" ekranı gösteriyordu, hiçbir test ikisini ayıramıyordu ve ayrı tutmak iki status, iki sebep ve dört çeviri demekti.

### 28.3 `provider_unavailable` bir ret sebebi değil

Bölüm 19 altı kodu tek liste olarak sayıyor; bunlar tek liste değil. Beşi yetkilendirme kararı, `provider_unavailable` ise yetkilendirme `allow` döndükten sonra ortaya çıkan bir ağ sonucu. Karar union'ına konursa, union üzerinde exhaustive çalışan her `switch` sonsuza kadar asla üretilemeyen bir dalı ele almak zorunda kalır.

### 28.4 Kullanıcının kendi verdiği MCP server'lar için her çağrıda onay şart

Bölüm 3.1 "Integration kullanıcıya ait değildir" diyor; bu yalnızca partner entegrasyonları için doğru. Kullanıcının kendi bağladığı bir MCP server için `origin: user` olan, sahibi o kullanıcı olan ve yalnızca ona görünen bir integration kaydı gerekir.

Bu kayıtlar için scope map yoktur — rastgele bir MCP server iş scope'u beyan etmez — dolayısıyla bağlantının kendisi grant'tir. Bu duruşun bedeli açık: tek bir "Bağla" tıklaması, kullanıcının URL'sini yapıştırdığı bir sunucuya sınırsız tool erişimi demektir. Telafisi, bölüm 11'in ayrımının bu yol için zorunlu hale gelmesidir: **her user-origin çağrısı per-call kullanıcı onayı ister.** Mevcut [tool-approval.ts](../products/chat/api/src/mcp/tool-approval.ts) yerel olarak keşfedilen tool'lar için zaten bu duruşta.

Ayrıca invariant 10, hedef URL'yi kullanıcının verdiği durumda az iş yapar: URL bağlanma anında sabitlenir ve dispatch sırasında bağlantıya karşı yeniden doğrulanır, modelin ürettiği hiçbir değerden okunmaz.

### 28.5 Scope map consent ile versiyonlanmıyor

Açık bir boşluk, kapatılması bir veri modeli kararı. Partner `cancel_order`'ı `orders.manage`'den `orders.read`'e taşırsa, "siparişleri görüntüleme" onayı vermiş her kullanıcı sessizce iptal yetkisi kazanır ve bu tasarımda hiçbir şey bunu fark etmez.

İki seçenekten biri Faz 5'ten **önce** seçilmeli: ya verilen scope'ların yanında manifest sürümü saklanıp kullanıcının onayladığı map'e karşı yetkilendirilir, ya da bir scope'un tool listesi büyüdüğünde yeniden onay zorlanır.

---

## 29. F3 ile kesinleşen kararlar

Yetkilendirme sunucusu metadata'sı ve istemci kaydı şeması (`integration_authorization`) yazılırken çıkan, bu belgenin önceki bölümlerini bağlayan kararlar.

### 29.1 `ConnectionAttempt`, `issuer` ve `token_endpoint`'i anlık kopyalamalı

Bölüm 15'teki `ConnectionAttempt` alanları yeterli değil. Tarayıcıya verilen yetkilendirme isteği ile callback arasında dakikalar geçiyor, ve bu sürede `integration_authorization` satırı yenilenmiş olabilir — muhtemelen saldırganın yerleştirdiği bir `token_endpoint`'e.

Kod değişimi güncel satırdan okursa, yetkilendirme kodu **ve client secret** o yeni adrese gider.

Attempt kaydı başlangıçta `issuer` ve `token_endpoint`'i saklamalı; callback saklı satırın `issuer`'ı ile karşılaştırmalı ve uyuşmazsa akışı reddetmeli. Kullanıcı yeniden başlatır.

### 29.2 `Integration.mcpUrl` değişmez sayılmalı

Keşif belirli bir `mcpUrl`'e karşı koştu ve `verifyProtectedResource` ile ona bağlandı. Url düzenlenirse satır artık başka bir kaynağın metadata'sını tarif eder: token eski kaynağa `aud` bağlı üretilir, yeni kaynağa sunulur.

`integration_authorization.resource` bunu saklıyor ve okuma predikatı `resource = mcp_url` şartını taşıyor, yani eşleşmeyen satır hiç dönmüyor. Ama asıl çözüm yapısal: **yeniden yönlendirilen bir MCP sunucusu yeni bir entegrasyondur, bir düzenleme değil.** Bölüm 20 invariant 10'un veri modeli karşılığı.

### 29.3 Issuer değişimi tüm bağlantıları `reauth_required`'a çekmeli

`client_id` bir yetkilendirme sunucusu tarafından verilir ve başkasında hiçbir anlamı yoktur. Veritabanı artık `client_issuer = issuer` kontrolüyle tutarsız bir satırı imkânsız kılıyor: `issuer`'ı güncelleyip client kolonlarına dokunmayan bir UPDATE reddediliyor.

Ama kayıt düştüğünde o entegrasyona ait mevcut bağlantılar da geçersizleşir — elde tuttukları token eski sunucunun ürünü. Yenileme yolu aynı işlemde bütün `connection` satırlarını `reauth_required` durumuna çekmeli. Enum değeri ve olay türü zaten mevcut; eksik olan yazma yolu.

### 29.4 Anahtar rotasyonu mümkün, ama yapılmıyor

`integration_authorization.key_version` taşınıyor ve bugün her satırda `1`. `CHAT_AUTH_SECRET` tek değer, arkasında keyring yok — rotasyon şu an mümkün değil.

Bedelin neden buraya özgü olduğu önemli: oturumlar için anahtar değişiminin bedeli "herkes yeniden giriş yapar". Saklanan credential'lar için bedeli **her kullanıcı her entegrasyonu yeniden bağlar**. Sürüm kolonu olmadan hangi satırın eski anahtarla yazıldığı da bilinemez.

Gerçek rotasyon, config'in geçerli + önceki kökü taşımasını gerektiriyor. O gelene kadar kolon provizyondur.

---

## 30. F4 ile kesinleşen kararlar

### 30.1 `oauth4webapi` tek bir dosyadan import edilir

Kütüphanenin her isteği `(options[customFetch] || fetch)` yazıyor. Seçeneği geçirmeyi unutan bir çağrı yeri düz `fetch`'e düşüyor: DNS doğrulaması yok, SSRF koruması yok, hata da yok. Disiplinle kapatılacak bir şey değil.

`src/connections/oauth-client.ts` kütüphaneyi adıyla anan tek dosya; her çağrıyı taşıyıcı bağlı halde sarıyor. `chatUntrustedHttp` lint kuralı `src/connections/**` içinde `oauth4webapi` importunu yasaklıyor, muafiyet yalnız o dosya.

### 30.2 Yönlendirme, isteğin ne taşıdığına göre

`GET /.well-known/...` gizli bir şey taşımıyor; 302 izlemek yalnızca dokümanı başka yerden okumak demek. `POST /register` ve ileride `POST /token` client secret ve authorization code taşıyor; yönlendirme izlemek o bilgiyi yeni adrese teslim etmek demek.

`guardedFollow` hop bütçesini çağırandan alıyor: metadata okumaları 3, kimlik bilgisi taşıyan istekler 0. MCP `initialize` probe'u POST ama kimlik bilgisi taşımıyor, o yüzden 3 ile koşuyor.

### 30.3 İstemcinin nasıl doğrulandığı ve nereye döneceği saklanır

`token_endpoint_auth_method`: RFC 7591 sunucunun istenenden başka bir yöntemle kayıt açmasına izin veriyor. Token isteğinde tahmin etmek her istekte kimlik doğrulama hatası demek, ve hata sunucuda oluştuğu için yerelde sebebi görünmüyor. Kolon `client_secret_basic`, `client_secret_post`, `none` ile sınırlı — `private_key_jwt` taşıyan bir satır hiç kullanılamayacak bir kayıt olurdu.

`registered_redirect_uri`: yetkilendirme isteği kayıtlıdan farklı bir uri verirse sunucu iki değeri de adlandırmayan bir hatayla reddediyor. Kayıt anındakini saklamak, uyuşmazlığı kullanıcı tarayıcıya gönderilmeden yakalayıp yeniden kayıtla cevaplamayı mümkün kılıyor.

### 30.4 Zaman damgaları tek saatten yazılır

`integration_authorization_timestamps_check` `verified_at >= discovered_at` istiyor. `discovered_at` kolonun DEFAULT'undan (veritabanı sunucusunun saati), `verified_at` uygulamadan (bu makinenin saati) gelirse, veritabanı başka bir hostta olduğu için saat farkı doğrudan reddedilen bir INSERT'e dönüşüyor. İkisi de `saveDiscovery` içinde aynı `new Date()`'ten yazılıyor.

## 31. F5 ile kesinleşen kararlar

### 31.1 Denemenin anlık kopyası zorunlu

`ConnectionAttempt` tarayıcı gönderilirken `issuer` ve `tokenEndpoint`'i yazıyor; callback bunlara karşı takas yapıyor. §29.1'in gereksinimi buydu. Yeniden keşif kullanıcı hâlâ yetkilendirme sunucusundayken satırı değiştirebilir, ve güncel satırdan okuyan bir callback yetkilendirme kodunu ve client secret'ı yenilemenin gösterdiği yere yollar.

İstemci sırrı yine de **güncel** satırdan okunuyor, ama `issuer` + `clientId` ile kapılı: issuer değiştiyse o kolonlar zaten temizlenmiş, sorgu boş dönüyor ve bağlanma başarısız oluyor. Doğru davranış — yanlış sunucuya sır göndermektense bağlanmamak.

### 31.2 Deneme tek kullanımlık

`consume` `updateMany`'i `consumedAt: null` ve `expiresAt > now()` ile filtreleyip `count === 1` arıyor. Önce okuyup sonra kontrol etmek iki çağrının da süresi dolmamış satırı okuduğu pencereyi bırakır. Yetkilendirme kodu tarayıcı geçmişinde ve referrer'da görünür; aynı state ile gelen ikinci callback takas edecek bir şey bulamıyor.

### 31.3 Token yalnız `active` bağlantıda durur

`connection_token_state_check`: `reauth_required` veya `revoked` bir satır token tutamaz. Issuer değişimi hem durumu hem token kolonlarını aynı statement'ta temizliyor. Bağlanma sırasında satır token yazılana kadar `reauth_required` kalıyor — bağlantının `publicId`'si şifrelemenin bağlama değeri olduğu için satırın önce var olması gerekiyor, ve o pencerede `active` duran bir satır sunacak token'ı olmayan bir çağrıyı yetkilendirirdi.

### 31.4 Şifreleme öznesi amaçtan türetilir

`CredentialCipherService` artık `client_secret`, `registration_access_token`, `code_verifier`, `access_token`, `refresh_token` taşıyor. Özne (`integration` / `attempt` / `connection`) `SUBJECT_OF` ile amaçtan türetiliyor, çağıran seçmiyor. Çağıran iki yarıyı da seçseydi, bir bağlantının token'ını entegrasyon altında mühürlemek o entegrasyonun **her kullanıcısı** için açılan bir başlık üretirdi.

### 31.5 Tarayıcıya kapalı bir kelime döner

Callback web'e `?status=<ConnectionOutcome>` ile dönüyor; liste `@chat/contracts`'ta sabit. Uzak sunucunun `error_description`'ı saldırganın yazdığı metin, ve onu bu ürünün kendi origin'inin adres çubuğuna yansıtmak o metnin bu ürünün sözü gibi okunma yolu.

**Açık kalan (F6'da kapandı):** `@chat/web` tarafında `/connections/callback` sayfası henüz yok. Bu dilim yalnız sunucu tarafı.

## 32. F6 ile kesinleşen kararlar

### 32.1 MCP çağrısı SDK ile değil, guarded transport ile yapılır

`@modelcontextprotocol/sdk`'nın streamable http taşıması çıplak `fetch` kullanıyor. `fetch` adı çözmeyi ve soketi açmayı tek adımda yapıyor, arada kanca yok — yani `guarded-http.ts`'in var olma sebebi olan SSRF/DNS-rebinding korumasını bütünüyle atlıyor. `remote-mcp.client.ts` el sıkışmayı (`initialize` → `notifications/initialized` → `tools/list`), `mcp-session-id` taşımayı ve `text/event-stream` gövdesini `guardedFollow` üstünde kendisi yapıyor. SDK eklenmedi.

Bu istekler bearer token taşıdığı için `maxRedirects: 0`. Keşif probe'unun 3 hop'u, o isteğin hiçbir kimlik bilgisi taşımamasından geliyordu.

### 32.2 Yetkilendirme isteğinin `scope`'u kaynağa göre seçilir

`IntegrationToolScope` bir partner manifestosunun scope haritası ve kullanıcının eklediği sunucu için boş. Boş kalınca istek scope'suz gidiyor ve scope zorunlu kılan AS'ler reddediyor — hem de kullanıcı tarayıcıdan ayrıldıktan sonra. `origin: "user"` yolunda scope artık PRM'in `scopes_supported` alanından (`IntegrationAuthorization.scopesSupported`) okunuyor; `partner` yolu değişmedi.

### 32.3 Keşif ekleme anında koşar, başarısızsa satır silinir

`POST /integrations` probe + PRM + AS metadata + DCR'ı senkron yapıyor. `IntegrationAuthorization` `integration_id`'ye kapılı olduğu için satır **önce** yazılmak zorunda; `ensureClient` `ready` dönmezse satır siliniyor. İstemcisi olmayan bir entegrasyon, connect akışının ancak reddedebileceği bir satır, ve onu listede bırakmak kullanıcıya hiç çalışmayacak bir düğme sunmak olurdu.

Satırın yazılmasıyla silinmesi arasında süreç ölürse yarım bir satır kalıyor. Bu pencere kapatılamaz — uzak çağrılar bir transaction içinde tutulamaz — ama sonucu kapatılabilir, ve `"duplicate"` dalı bunu yapıyor: ikinci ekleme pes etmek yerine o satırı okuyup `ensureClient`'ı tekrar deniyor. Tamamlanırsa satır artık sağlam ve cevap `integration_duplicate`; tamamlanamazsa satır siliniyor ve kullanıcı **gerçek** sebebi görüyor. Böylece hiçbir durum kullanıcıyı kilitlemiyor.

Geri alma yalnız **hiç bağlantısı olmayan** satıra uygulanıyor (`loadReclaimable`). Tekrar denemek tamamlayamadığını siliyor, ve birinin yetkilendirdiği bir entegrasyonu oraya sokmak o kullanıcının grant'ini beraberinde götürürdü.

### 32.4 Aynı sunucu bir sahibe iki kez eklenemez

`integration (owner_id, mcp_url) WHERE origin = 'user'` kısmi tekil indeksi. Olmadan ikinci ekleme ikinci bir yetkilendirme satırı ve aynı AS'ye ikinci bir dinamik istemci kaydı doğuruyor, kullanıcı da hangi bağlantının hangisine ait olduğunu ayırt edemediği iki özdeş kart görüyor. Yarışı indeks karara bağlıyor: `create` `P2002`'yi yakalayıp `"duplicate"` diyor, okuma-sonra-yazma penceresi yok.

### 32.5 Yenileme tek uçuşlu, kilitle değil kirayla

`connection.refresh_lease_until` kolonu, koşullu bir `updateMany` ile alınıyor ve `count`'a bakılıyor. Prisma havuzunda oturum ömürlü `pg_advisory_lock` güvenli değil (kilit ve serbest bırakma farklı bağlantıya düşebilir), işlem ömürlü olanı ise bir HTTP çağrısı boyunca havuz bağlantısını tutar. Kira, bu repoda `consume` ve `saveRegistration`'da zaten kullanılan desenin aynısı.

Neden gerekli: refresh token döndüren bir AS, aynı token'ın ikinci harcanmasını `invalid_grant` ile cevaplıyor, ve o cevap kullanıcının gerçekten iptal ettiği bir grant'ten ayırt edilemiyor. Kirayı kaybeden çağıran yenilemiyor, tutanı bekliyor.

Yenilemenin sonuçları ayrık: **sunucunun kendi reddi** (`invalid_grant`) bağlantıyı `reauth_required` yapıyor; **taşıma hatası** satıra hiç dokunmuyor. Sağlayıcıdaki geçici bir kesinti, o sağlayıcıyı kullanan herkesi yeniden yetkilendirmeye zorlamamalı.

`resource` yenilemede de gönderiliyor. RFC 8707 token'ı tek kaynağa bağlıyor; atlanırsa yenileme her turda kapsamı sessizce genişletirdi.

### 32.6 Koparma önce refresh token'ı iptal eder

RFC 7009 sırası `refresh_token` → `access_token`. Ters sırada, access iptal edilip refresh hâlâ geçerliyken süreç ölürse grant'in yenilenebilir yarısı hayatta kalıyor. Uzak iptal başarısız olsa da yerel satır temizleniyor: iptal isteğine `200` almak grant'in gittiğinin kanıtı değil (RFC 7009 tanımadığı token'a da `200` diyor), ama koparma düğmesine basan kullanıcının koparılmış olması gerekiyor.

### 32.7 Bağlantı sonrası `tools/list` bağlantıyı geçersiz kılmaz

Callback tokenları yazdıktan sonra araçları çekip `integration_tool`'a yazıyor. Bu çağrı başarısız olursa bağlantı yine `"connected"` dönüyor — token gerçekten alındı ve mühürlendi, ve boş bir araç listesi hiçbir şey göstermeyen bir sayfa demek; oysa `connection_failed` demek kullanıcının tamamladığı yetkilendirmeyi çöpe atmak olurdu.

## 33. F7 ile kesinleşen kararlar

### 33.1 MCP ekosisteminin yarısı OAuth konuşmuyor

F6 her MCP sunucusunun OAuth konuştuğu varsayımıyla yazıldı. Varsayım yanlış ve gerçek bir sunucuda kırıldı — `https://mcp.solana.com/mcp` token'sız `initialize`'a `200`, token'sız `tools/list`'e beş araç döndürüyor ve `.well-known/oauth-protected-resource` yayınlamıyor. Bizim keşif buna `unreachable` diyordu, yani kullanıcı cevap veren bir sunucu için "Sunucu cevap vermedi" görüyordu.

### 33.2 Probe dört durumu ayırıyor

Eski `probe()` cevabın status'unu hiç okumuyordu ve `GuardedOutcome`'ın `"response"` ile `"failed"` dallarını birleştiriyordu. Dört ayrı gerçek — açık sunucu, çıplak `Bearer` challenge'ı, çerçeveyi reddeden sunucu, hiç cevap vermeyen adres — tek değere çöküyordu. `probeAuthorization` bunları ayırıyor.

Challenge'ın **varlığı** karar veriyor, ayrıştırılan url değil: `resourceMetadataUrlFrom` yalnız `resource_metadata="..."` yakalıyor, yani çıplak bir `Bearer` de `undefined` veriyor ve onu "challenge yok" diye okumak, korumalı bir sunucuya token'sız gitmek demekti.

Gövde ayrıştırılmıyor. `200` dönen rastgele bir web sunucusu burada `open` sınıflanıp bir adım sonra `tools/list` araç üretemediği için reddediliyor — bir url'in MCP sunucusu olup olmadığına tek yer karar veriyor.

### 33.3 Açık kayıt atomik, OAuth kaydı olamaz

Açık sunucuda pazarlık edilecek bir şey yok, dolayısıyla bütün uzak çağrılar ilk satır yazılmadan bitiyor: `integration` + `connection` + araçlar **tek transaction**. F6'nın OAuth yolundaki "yarım satır" penceresi burada hiç yok.

Açık sunucu için token'sız `active` bir `Connection` açılıyor. `authorizeInvocation` `origin: "user"` yolunda yalnız varlık, sahip, entegrasyon eşleşmesi ve `status === "active"` bakıyor; scope'a, araca, token'a hiç bakmıyor. Böylece 25 testi olan güvenlik fonksiyonuna ve `STRATEGY_BY_ORIGIN`'e hiç dokunulmadı.

### 33.4 Açıklık iddiası araçlar listelenerek kanıtlanıyor

`initialize`'ı herkese cevaplayıp araçlarını koruyan bir sunucu açık değil. `registerOpen` önce token'sız `tools/list` deniyor; `unauthorized` gelirse kayıt OAuth yoluna düşüyor. Sunucunun kendi davranışı karar veriyor, probe'un tek bir cevabı değil.

### 33.5 Kullanımdaki kopya ağa çıkılmadan reddediliyor

`findOwnedByUrl` sahibin satırını ve **kullanımda olup olmadığını** birlikte döndürüyor. Kullanımdaki bir satır probe'dan önce `integration_duplicate` ile reddediliyor: tekrar deneme yolu tamamlayamadığını siliyor ve oraya birinin yetkilendirdiği bir entegrasyonun girmesi o grant'i de götürürdü. Ayrıca zaten reddedilecek bir url için bu sürecin dışarı bağlantı açmasının sebebi yok.

### 33.6 Kapanan sunucu yerinde yükseltiliyor

`POST /integrations/:id/tools` araç listesini tazeliyor. Açık bir entegrasyon `unauthorized` alırsa keşif + DCR koşuyor, `auth_mode` `oauth` oluyor ve bağlantı aynı transaction'da `reauth_required`'a düşüyor. Kullanıcı entegrasyonu ve geçmişini kaybetmiyor, bir kez yetkilendiriyor.

İstemci **önce** kaydediliyor, mod sonra çevriliyor. Ters sıra, ne açık kullanılabilen ne yetkilendirilebilen bir entegrasyon bırakırdı; yükseltme başarısızsa satıra hiç dokunulmuyor.

### 33.7 İki saat, bir kısıt — ikinci kez

`connection_token_state_check` `authorized_at >= created_at` istiyor. `created_at` kolon varsayılanından (veritabanı sunucusunun saati), `authorizedAt` `new Date()`'ten (bu host) geliyordu. Açık kayıt testi bunu **kesikli olarak** kırdı: aynı kod bir koşuda geçti, bir koşuda `23514` aldı.

Bu F4'te `discovered_at`/`verified_at` ile yakalanan tuzağın aynısı. `createOpen` ikisini de tek `new Date()`'ten yazıyor; `beginAuthorization`'daki aynı gizli hata da (satırı DB saatiyle yaratıp `completeAuthorization`'da uygulama saatiyle işaretlemek) birlikte kapatıldı.

## 34. F8 ile kesinleşen kararlar

### 34.1 Araçlar tanımlanıyor, azı etkinleştiriliyor

`integration_tool` satırları F6'dan beri yazılıyor ve sayılıyordu; hiçbir şey okumuyordu. Köprü kurulurken bağlam maliyeti asıl kısıttı: üç sunucu bağlayan kullanıcıda her mesaja onlarca araç şeması giriyor.

Çözüm `activeTools`. `stream-text.ts:2325` `filterActiveTools(...)` çağırıyor ve sağlayıcıya yalnız süzülmüş küme serileştiriliyor, dolayısıyla bütün araçlar `tools`'ta **tanımlı** kalıp yalnız `find_tools`'un açığa çıkardıkları etkin oluyor. Araç seti kırpılmıyor; modele gösterilen kırpılıyor.

`find_tools` bizim aracımız, keşfedilmiş değil: `ChatToolName` enum'una girdi, kapalı liste kapalı kaldı ve kendi veritabanımızı okuduğu için `approvalFor` onu otomatik onaylıyor.

### 34.2 Adım 0 geçmişten tohumlanıyor, kayıp adlar mezar taşı alıyor

İki ayrı davranış ölçüldü, ikisi de tasarımı değiştirdi.

`parse-tool-call.ts:95-113` dış catch `NoSuchToolError`'ı **fırlatmıyor** — `invalid: true` bir tool-call döndürüyor ve `stream-language-model-call.ts:697` onu `tool-error` parçasına çeviriyor. Yani bilinmeyen bir ad turu öldürmüyor, sadece bir adım harcıyor. Bu yüzden adım 0'ın `activeTools`'u gelen geçmişte zaten geçen adlarla tohumlanıyor: model az önce kullandığı aracı yeniden aramıyor.

Ama `execute-tool-call.ts:89` `!isExecutableTool(tool)` için `undefined` dönüyor ve `stream-text.ts:2113` `result != null` ile eliyor — **onay dönüşünde aracı kaybolmuş bir çağrı hiç sonuç yazmıyor**. Geriye sonuçsuz bir araç çağrısı kalıyor, ki bu `ChatService`'in zaten belgelediği boş asistan turu ve sonsuz yeniden-gönderim. Mezar taşı saplamalarının tek gerekçesi bu, ve yalnız `^i[0-9a-f]{8}_` şeklindeki adlara konuyor: yerel bir okuyucu adına konsa gerçek aracı gölgelerdi.

### 34.3 Açık ad `public_id`'den türüyor

Sağlayıcıların araç adı kısıtı pratikte `^[a-zA-Z0-9_-]{1,64}$`; uzak adlar 128 karaktere kadar çıkabiliyor ve nokta içerebiliyor. Açık ad `i` + `public_id`'nin sha256'sından 8 hex + `_` + sanitize edilmiş ad.

Önek **`display_name`'den değil** `public_id`'den türüyor: ad değiştirilebilir bir alan ve değişince konuşma geçmişindeki her araç çağrısı öksüz kalırdı. Sanitize veya kesme bir şeyi değiştirdiyse tam adın digest'inden 7 hex ekleniyor, yoksa yalnız noktalamayla ayrılan iki araç tek ada çökerdi.

Çakışma bir **hata**: sayaçla numaralandırmak sıraya bağlı olurdu ve turlar arası sessizce yeniden numaralandırmak, tam da kaçınılan geçmiş bozulması demekti. İkinci araç düşüyor ve iki ad da loglanıyor.

Modelin ürettiği ad **haritadan** çözülüyor, dize bölünerek değil. Tarayıcı da entegrasyonu bilmiyor — AI SDK'nın onay yanıtı yalnız `{ id, approved }` taşıyor — bu yüzden hatırlama isteği açık adla anahtarlanıyor ve sunucu kataloğu yeniden kurup adı çözüyor.

### 34.4 Digest ingest anında hesaplanıyor

Hatırlanan onay, onaylanan **tanıma** bağlı: sunucu adı koruyup ne yaptığını değiştirebilir. Digest `sha256("mcp-tool-v1\n" + canonical({name, description, annotations, inputSchema}))`.

Okuma anında hesaplamak sağlam değil. V8 `JSON.parse`/`JSON.stringify` sırasında sayı-benzeri anahtarları öne alıyor, yani `properties` içinde `"1"` ve `"a"` olan bir şema Postgres'te ve bu süreçte farklı hash'lenirdi; dahası bir sürücü değişikliği **bütün kullanıcıların bütün onaylarını** bir günde düşürürdü. Digest `integration_tool.definition_digest` kolonunda, `listTools`'un ayrıştırdığı nesneden bir kez yazılıyor.

`title` hariç — saf görüntü. `description` normalize **edilmiyor**: açıklama, sunucunun modele ne yapacağını anlattığı yer, yani birincil prompt injection yüzeyi; her değişikliği anlam değişikliğidir. Bedeli açık: açıklamasını her seferinde yeniden üreten bir sunucu her saat yeniden sorar.

### 34.5 Annotation'lara asimetrik güven

`destructiveHint: true` barı **yükseltiyor** — hatırlanmış olsa da her seferinde soruluyor. `readOnlyHint` otomatik onay için **yok sayılıyor**. Yalan söyleyen sunucu kendini yalnız daha zahmetli yapabiliyor.

Spec'in `destructiveHint` varsayılanı `true`, ama yalnız **açıkça yazılmış** `true` bağlayıcı. Harfiyen uygulansaydı annotation yayınlamayan her sunucunun her aracı yıkıcı sayılır ve hatırlama özelliği hiç ateşlemezdi.

Bu asimetri yüzünden `read_only` diye bir mod eklenmedi: o mod `readOnlyHint`'e güvenmek zorunda kalırdı ve `tool-approval.ts`'in zaten yazılı kararıyla çelişirdi.

### 34.6 Hatırlama kalıcı, `integration_tool`'a bağlı değil

`replaceTools` her tazelemede satırları silip yeniden yazıyor. `tool_approval` o tabloya FK verseydi saatlik TTL kalıcı onayları süpürürdü, ve kesinti sırasında boş liste dönen bir sunucu verilmiş rızayı kalıcı olarak silerdi. Bağ yok; çekilmiş bir araç okuma yolunda `available: false` olarak bildiriliyor.

Digest anahtarın parçası değil: kalıcı hatırlamada digest'li anahtar, sunucu her açıklama düzelttiğinde ölü satır bırakır ve arayüzde aynı aracı üç kez gösterirdi. Dışarıda kalınca yeniden onay bir `upsert`.

`tool_approval_integration_idx` şart — Postgres FK'nın referans eden kolonunu indekslemiyor, entegrasyon silmede cascade tabloyu seq-scan ederdi. PK'nın `user_id` öneki kullanıcı okumalarını ve `app_user` cascade'ini zaten karşılıyor.

### 34.7 Tazeleme turun kritik yolunda değil

`LIST_TIMEOUT_MS` 10 sn. Altı bayat entegrasyonu olan kullanıcı ilk token'dan önce dakikalarca bekleyebilirdi ve tek bir ulaşılamaz sunucu her turu vergilendirirdi. 1 saatlik bayatlık zaten kabul edilmişken bir tur daha kabul etmek bedavaya geliyor: araç seti o anki satırlardan kuruluyor, tazeleme ayrık tetikleniyor.

Tek istisna `tools_refreshed_at IS NULL` — az önce bağlanmış sunucu bir tur boyunca görünmez olmamalı.

Kira tek `updateMany`, ve **kaybeden beklemiyor**. Token kirasında beklemek zorunlu (token'ı olmayanın sunacağı bir şey yok); bayat araç listesi gayet kullanılabilir, beklemek saf gecikme vergisi. Başarısız tazeleme de pencereyi tüketiyor, yoksa sağlayıcı kesintisine karşı tur-başına sağlık yoklaması kurulmuş olurdu.

Bilinen sınır: sayaç `integration` üzerinde global, yani aynı partner entegrasyonuna bağlı iki kullanıcıdan birinin tazelemesi diğerininkini bastırıyor. `auth_mode: "none"` entegrasyonlarının bağlantı satırı olmadığı için doğru ev iki kolon demekti; ilk partner entegrasyonunda yeniden bakılacak.

### 34.8 Sunucunun JSON Schema'sı sağlayıcıya olduğu gibi gitmiyor

`jsonSchema()` doğrulama yapmıyor. Kök seviyede nesne olmayan bir tip, `$ref` veya bilinmeyen bir draft, **bütün isteği** 400'letirdi — turdaki her araç ölürdü, sadece bozuk olan değil. `sanitizeToolInputSchema` kökün `type === "object"` olmasını şart koşuyor, meta anahtarları sıyırıyor, `$ref` taşıyan belgeyi tümüyle opak bir şemaya çeviriyor ve 8 KB tavanı uyguluyor.

`$ref` yerinde budanmıyor: bir `anyOf` dalını atmak şemanın neyi kabul ettiğini sessizce değiştirirdi, ve kendi şekli hakkında yalan söyleyen bir şema hiçbir şey söylemeyenden kötüdür.

### 34.9 Uzak sonuç veri, talimat değil

Her uzak sonuç `untrustedServerOutput` alanında dönüyor ve sistem talimatı bu alanı adıyla güvenilmez ilan ediyor. Sunucunun kendi `isError`'ı fırlatılmıyor, taşınıyor: fırlatmak sunucunun metnini SDK'nın hata biçimlendirmesine yedirir ve modele düzeltecek bir şey bırakmazdı. İki tavan var — taşımada 512 KB süreç için, ayrıştırmadan sonra ~24 000 karakter bağlam penceresi ve adım bütçesi için.

Ve bir taşıma kusuru kapandı: `guarded-http.ts` boyut aşımını `{ kind: "failed" }` olarak bildiriyordu, `failureOf` onu `unreachable`'a eşliyordu — yani büyük bir cevap kullanıcıya "sunucuya ulaşılamadı" dedirtiyordu. `failed` artık `reason: "transport" | "oversized"` taşıyor ve `too_large` ayrı bir hata olarak görünüyor.

### 34.10 Oturum kullanıcı başına önbellekleniyor

Her çağrıda tam el sıkışma 3 tur demek. Önbellek anahtarı `${userId}:${integrationPublicId}` — entegrasyon tek başına asla: oturum kullanıcının bearer'ını taşıyor ve sunucu durumu oturum id'sine bağlayabiliyor.

Sunucu oturumu düşürdüğünde (`mcp-session-id` sunulurken gelen `404`) **tam bir kez** yeniden el sıkışılıyor; döngü bearer'ı tekrar tekrar oynatırdı. Kaynağın `401`'i yetkilendirme sunucusunun reddi değil, o yüzden sohbet yolu `markReauthRequired` çağırmıyor — o kararın sahibi `ConnectionTokenService`.

## 35. Teknik referanslar

- Model Context Protocol — 2026-07-28 specification release and authorization hardening:  
  https://blog.modelcontextprotocol.io/posts/2026-07-28/
- RFC 9700 — Best Current Practice for OAuth 2.0 Security:  
  https://www.rfc-editor.org/rfc/rfc9700.html
- RFC 7009 — OAuth 2.0 Token Revocation:  
  https://www.rfc-editor.org/rfc/rfc7009.html
- RFC 10017 — OAuth 2.0 for Browser-Based Applications:  
  https://www.rfc-editor.org/rfc/rfc10017.html
