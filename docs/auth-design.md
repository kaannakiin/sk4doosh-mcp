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

## 29. Teknik referanslar

- Model Context Protocol — 2026-07-28 specification release and authorization hardening:  
  https://blog.modelcontextprotocol.io/posts/2026-07-28/
- RFC 9700 — Best Current Practice for OAuth 2.0 Security:  
  https://www.rfc-editor.org/rfc/rfc9700.html
- RFC 7009 — OAuth 2.0 Token Revocation:  
  https://www.rfc-editor.org/rfc/rfc7009.html
- RFC 10017 — OAuth 2.0 for Browser-Based Applications:  
  https://www.rfc-editor.org/rfc/rfc10017.html
