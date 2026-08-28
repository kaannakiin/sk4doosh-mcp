# Faz 1 — Walking Skeleton

## Hedef

Projenin tek en riskli bahsini kanıtlamak: **sentetik `HttpContext` ile in-process dispatch, ASP.NET Core'un `[Authorize]`/policy davranışını birebir korur.** Bu kanıtlanmadan spec yazmak, SDK genelleştirmek anlamsız — her şey bu mekanizmanın üstüne oturuyor.

Bu fazda hiçbir şey genelleştirilmez. Kod elle bağlanır, hardcoded olur, atılabilir parçalardan kurulur — ucuz kurulsun, ucuz revize edilsin diye.

## Somut çıktılar

- `sdks/dotnet/samples/DemoApi`: 2-3 endpoint'li minimal ASP.NET Core uygulaması; en az biri `[Authorize]`/policy arkasında, en az biri anonim.
- Elle yazılmış (keşif yok, attribute taraması yok) tek MCP tool: bir endpoint'i sentetik `HttpContext` üretip gerçek middleware pipeline'ından geçirerek çağırır.
- `ModelContextProtocol.AspNetCore` ile ayağa kalkan MCP endpoint'i (`MapMcp`), Streamable HTTP.
- Kısa bir deney notu (yanına [notlar.md](notlar.md) olarak): neyin çalıştığı, neyin sürpriz çıktığı — Faz 2'nin ham maddesi.

## Bitti kriteri

- Gerçek bir MCP client (inspector veya Claude) tool'u çağırıp cevap alıyor.
- Çağıran kimlik/token değiştirildiğinde yetki sonucu, aynı endpoint'e normal HTTP isteğiyle **birebir aynı**: 200/401/403 eşleşiyor, policy değerlendirmesi aynı davranıyor.
- Aynı doğrulama, eldeki gerçek C# server'ın bir endpoint'ine karşı da tekrarlanmış (co-develop gerçeklik testi).

## Bu fazda çözülecek açık sorular

- Sentetik `HttpContext`'e `User`/claims pipeline girişinden **önce** nasıl doğru doldurulur? (Authentication middleware'i yeniden mi koşmalı, yoksa doğrulanmış principal doğrudan mı taşınmalı?)
- Pipeline'a Kestrel yerine sentetik girişte middleware sıralaması hangi varsayımları kırıyor? (routing, endpoint metadata, `IHttpContextAccessor`)
- Response body nasıl yakalanır (buffering), status code ve ProblemDetails nasıl okunur?
- MCP endpoint'inin kendisi ile tool'un dispatch ettiği endpoint aynı host'ta — recursion/deadlock riski var mı?
