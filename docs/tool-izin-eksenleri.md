# Tool İzin Modeli — Ertelenen İki Eksen

**Durum:** Tasarım notu / ertelenmiş karar
**Tarih:** 17 Eylül 2026
**Odak:** Hatırlanan izinlerin hangi boyutlarda kırılabileceği
**Kapsam:** `products/chat` — `tool_approval` tablosu, onay kapısı, onay kartı

---

## 1. Bugün nerede duruyoruz

Kapsam ve süre eksenleri kuruldu. Bir izin artık şunlarla sınırlanabiliyor:

- **Kapsam** — `scope_key`: bir konuşma (`chat_session.public_id`) ya da her yer (`''`)
- **Süre** — `expires_at`: grant anında kullanıcının `grant_ttl` tercihinden hesaplanıyor

Karar sırası (`decideToolApproval`):

```text
policy auto?        → izin ver
policy always?      → sor
destructive?        → sor
mod always_ask?     → sor
grant yok?          → sor
grant süresi doldu? → sor
digest değişti?     → sor
                    → izin ver
```

Bu notta kayda geçen iki eksen **kurulmadı**.

---

## 2. Sayım ekseni

### Problem

Süre ekseni riski duvar saatiyle sınırlıyor, ama asıl risk **çağrı sayısıyla** ölçekleniyor. Kullanıcı "1 saat serbest" dediğinde modelin o saat içinde aracı 3 kez mi 300 kez mi çağıracağını bilmiyor. "Sonraki 5 kullanım" diyebilseydi bilirdi.

Bugünkü tek üst sınır adım bütçesi: bir turn içinde en fazla 8 (bağlı MCP sunucusu varsa 12) adım. Yani hatırlanmış bir araç tek turn'de en çok o kadar çalışabiliyor. Turn'ler arası hiçbir sınır yok.

### Neden ertelendi

Asıl sebep kapsam değil, öncelik: asimetriyi çözmek ve iki kapıyı birleştirmek zaten büyük bir işti, ve sayım üç eksen içinde en az kazandıranı.

Şemaya spekülatif bir sütun da **koymadık**. PostgreSQL 17'de nullable ve default'suz sütun eklemek anlık olduğu için "bir migration tasarrufu" gerekçesi ayakta durmuyordu; geriye yalnızca hiçbir şeyin okumadığı bir `uses_left` sütununun şemayı okuyan kişiye var olmayan bir özelliği vaat etmesi kalıyordu.

### Kurulacaksa nasıl

Naif yol — her araç çağrısında `UPDATE tool_approval SET uses_left = uses_left - 1` — kapıyı bozar. `ToolApprovalGateService.gateFor` bilinçli olarak turn başına **tek okuma** yapıp senkron bir closure döndürüyor; çağrı başına yazma onu async yapar ve eşzamanlı araç çağrılarında satır kilidi getirir.

Guard'ı bozmadan yapılabilir:

1. `uses_left` kapının kapattığı closure'da **bellekte** azaltılır. `RemoteToolSetService`'teki `revealed` Set'i tam olarak bu deseni kullanıyor — turn boyunca yaşayan, kapının kapattığı mutable state.
2. Turn sonunda `ChatHistoryService.settle` içinde **bir kez** yazılır.

Sonuç: turn içinde tam doğru, turn'ler arası tam doğru, çağrı başına sıfır yazma.

**Bedeli:** turn iptal edilir veya çökerse o turn'ün azaltması yazılmaz, kullanıcı hak ettiğinden fazla kullanım alır. Aşım adım bütçesiyle sınırlı, yani en fazla 8–12. Kabul edilebilir.

**UI bedeli:** onay kartında üçüncü bir kontrol. Kart bugün tek kontrolde (kapsam) tutuluyor ve süre bilinçli olarak ayarlara taşındı; sayım da muhtemelen oraya değil karta ait, çünkü karara özgü.

---

## 3. Argüman körlüğü

### Problem

İzin **araç adına** veriliyor, çağrının argümanlarına değil. Kapı `toolCall.toolName` ve `toolCall.dynamic` okuyor; `toolCall.input` hiç okunmuyor.

Somut sonucu: bir sunucunun `delete_file` aracını hatırlarsan, bu **her dosya** için geçerli olur. Sakladığımız digest yalnızca aracın _tanımını_ koruyor — sunucu şemayı değiştirirse izin düşüyor — ama o aracın hangi argümanla çağrıldığını hiç umursamıyor.

Aynı şey birinci parti tarafta da geçerli: `read_sheet` için verilen izin her çalışma kitabını kapsıyor.

### Neden zor

Argüman bazlı izin "hangi argüman aynı sayılır" sorusunu doğuruyor ve bunun genel bir cevabı yok. `{filePath: "a.xlsx"}` ile `{filePath: "a.xlsx", range: "B2:D9"}` aynı izin mi? Dosya aynı ama okunan alan farklı.

Muhtemel yön: aracın şemasında hangi alanların **kimliğe** ait olduğunu işaretlemek (`filePath` evet, `range` hayır) ve izni o alt kümenin digest'ine bağlamak. Bu, işaretlemeyi araç tanımına taşır — yani `@chat/contracts` katalogları, uzak araçlarda ise sunucunun bize söylemediği bir şey. Uzak taraf için çözümsüz kalabilir.

### Şimdilik ne koruyor

- `destructive` araçlar hiçbir izinle sessizleşmiyor — sunucu aracını yıkıcı ilan ederse her çağrıda soruluyor
- `codex_task` politikası `always`, yani her görev ayrı onaydan geçiyor
- Onay kartı çağrının argümanlarını gösteriyor, ve onay HMAC ile o çağrıya bağlanıyor (`experimental_toolApprovalSecret`) — yani kullanıcının onayladığı argümanlarla çalışan argümanlar aynı

Boşluk yalnızca **hatırlanmış** izinlerde: o durumda kullanıcı çağrıyı hiç görmüyor.
