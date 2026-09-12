# @sk-mcp/excel-mcp

Ajanın yerel Excel dosyalarını **okuduğu** bağımsız bir MCP sunucusu. Yazma işlemi yoktur.

Okunan biçimler: `.xlsx`, `.xlsm`, `.csv`. Sandbox, doküman önbelleği, hata zarfı, cursor codec ve tool kayıt katmanı [@sk-mcp/file-core](../file-core)'dan gelir.

Hücreleri, aralıkları, birleştirmeleri, formülleri ve tanımlı adları SheetJS okur. Data validation, Excel Table, koşullu biçim, resim ve dondurulmuş bölme bilgisi doğrudan OOXML part'larından okunur. Çalışma zamanında exceljs yoktur.

## Kurulum

Sunucu, okumasına izin verilen klasörü **zorunlu bir argüman** olarak alır. Bu klasörün dışı okunamaz.

```json
{
  "mcpServers": {
    "excel": {
      "command": "npx",
      "args": ["-y", "@sk-mcp/excel-mcp", "/Users/me/sheets"]
    }
  }
}
```

Depo içinden çalıştırmak için:

```bash
pnpm turbo run build --filter=@sk-mcp/excel-mcp
node packages/excel-mcp/dist/cli.js /Users/me/sheets
```

Inspector ile denemek için:

```bash
npx @modelcontextprotocol/inspector node packages/excel-mcp/dist/cli.js /Users/me/sheets
```

## Tool'lar

| Tool                      | İş                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `list_workbooks`          | Kök altındaki okunabilir dosyaları listeler. Döndürdüğü `filePath` diğer tool'lara aynen verilir          |
| `describe_workbook`       | Sheet'ler, used range, merge/validation sayıları, formül önbellek kapsamı, tanımlı adlar                  |
| `read_sheet`              | Hücre aralığını kompakt grid olarak okur: hoist edilmiş kolon başlıkları + satır dizileri                 |
| `get_merged_ranges`       | Birleştirilmiş hücre aralıkları                                                                           |
| `get_data_validations`    | Doğrulama kuralları, dikdörtgen aralıklara geri gruplanmış                                                |
| `get_tables`              | Sheet'in tanımladığı Excel Table'ları: aralık, başlık/toplam satırı, kolon adları ve A1 harfleri          |
| `get_conditional_formats` | Koşullu biçimlendirme kuralları yüklem olarak: hedef aralıklar, kural türü, operatör, formüller, eşikler  |
| `get_images`              | Sheet'e gömülü resimler: çapa aralığı, bayt boyutu, uzantı. Chart/pivot/sparkline reddedilir              |
| `aggregate_sheet`         | Sunucu tarafında sayım/toplam/ortalama ve gruplama; büyük sheet'te `read_sheet` sayfalamanın yerine geçer |
| `find_in_sheet`           | Değere veya formüle göre hücre arar                                                                       |

Büyük bir sheet'i `read_sheet` ile sayfalamak yerine `aggregate_sheet`, `find_in_sheet` veya dar bir `range` tercih edin; `describe_workbook` ve `read_sheet` bunu `guidance`/`hint` alanlarıyla söyler.

## Başlık satırı

`mergedCells` başlık satırını da etkiler. Varsayılan `master` altında birleşik bir hücrenin
yalnız ilk kolonu başlık taşır; `repeat` altında birleşmenin kapsadığı her kolon aynı başlığı
alır. İki satırlı başlıklarda ilk kolon çoğu zaman dikey birleşiktir (`A1:A2`) ve o başlık
ancak `repeat` ile isimle adreslenebilir. Yatay bir grup etiketi (`B1:C1`) ise `repeat` altında
birden çok kolona aynı adı verir ve `ambiguous_column` döner — harfle adresleyin.

`headerRow` **hiçbir zaman kendiliğinden sezilmez**; verilmezse 1'dir. Her yanıt `headerRowSource`
ile satırı kimin seçtiğini söyler: `"explicit"` (siz verdiniz), `"declared"` (sayfadaki Excel
Table veya autofilter beyan etti), `"scanned"` (`headerScan` ile ispatlandı), `"default"`
(kimse seçmedi, 1 varsayıldı), `"cursor"` (sayfalama token'ından geldi).

Excel bir tablonun başlık satırını çoğu zaman **örtük** bırakır: `headerRowCount` attribute'unu
hiç yazmaz ve yokluğu spec'e göre "başlık var" demektir. `"declared"` bu durumu da tanır —
tablonun ilan ettiği kolon adları tablo aralığının ilk satırındaki hücrelerle eşleşiyorsa başlık
satırı ispatlanmış sayılır. Adlar kısmen eşleşiyorsa hiçbir şey iddia edilmez ve akış
`headerScan`'in ispat kurallarına düşer.

Birleşik bir başlık bandı + boş satır + gerçek başlık, Excel çıktılarında yaygındır ve
varsayılan `headerRow: 1` orada sessizce yanlış sayar. İki savunma var: yanıt böyle bir durumda
`warnings` ile gerçek başlık satırını adlandırır, ve `headerScan: true` satırı tek çağrıda
ispatlar. `headerScan` ispatlayamazsa **tahmin etmez**: aday yoksa `unknown_header_row`, birden
fazla aday varsa `ambiguous_header_row` döner ve `recovery` aday satırların metnini yazar.
`headerScan`, `headerRow` veya `cursor` ile birlikte verilemez ve CSV'de `unsupported_for_format`
döner.

## CSV

Değerler **hiç yorumlanmaz**: `01234` string kalır, `03-04-2024` tarihe çevrilmez, `true` boolean olmaz. Ayraç sniff edilir ve her yanıtta `csv.delimiter` + `csv.delimiterSource` ile echo'lanır; iki aday eşitse `ambiguous_delimiter` döner ve `delimiter` parametresini istersiniz. Encoding BOM'dan çözülür, yoksa utf-8 denenir; Türkçe Excel çıktısı için `encoding: "windows-1254"` verin.

CSV'nin taşıyamadığı bir şey açıkça istenirse (`valueMode`, `mergedCells: "repeat"`, `includeHyperlinks`, `get_merged_ranges`, `get_data_validations`, `get_tables`, `get_conditional_formats`, `get_images`) `unsupported_for_format` döner — boş sonuç değil. `describe_workbook` hangi yeteneklerin mevcut olduğunu `capabilities` bloğunda önceden bildirir.

Chart, pivot table ve sparkline **hiçbir formatta** okunamaz — bu bir CSV kısıtı değil, okuyucunun tavanı: exceljs `xl/charts/*.xml`'i hiç açmıyor, pivot için object model'i yok, sparkline'lar worksheet `extLst`'inde tanınmıyor. `get_images` bu türler açıkça istendiğinde `unsupported_object_kind` döner ve `capabilities` bloğu üçünü de her iki formatta `false` bildirir.

## Zengin metadata

`get_data_validations`, `get_tables`, `get_conditional_formats` ve `get_images` OOXML part'larını `saxes` ile namespace-duyarlı okur. Eşleştirme `(namespace uri, local ad)` üzerinden yapılır — dosyanın yazdığı prefix'e hiç bakılmaz — bu yüzden `<x:dataValidation>` ile `<dataValidation>` çağrı yerinde ayırt edilemez. Sonuç: bu tool'lar her OPC yerleşiminde çalışır, prefix'li .NET çıktılarında ve worksheet part'ı `sheet.xml` diye adlandırılmış dosyalarda dahil.

Okunanlar ve nereden:

| tool | kaynak |
| --- | --- |
| `get_data_validations` | worksheet part, `dataValidations/dataValidation`. Aralıklar `sqref`'ten olduğu gibi alınır, hücre hücre açılmaz — tüm sütunu kaplayan kural da tam sayılır, `dataValidationRuleCountExact` her zaman `true` |
| `get_tables` | worksheet `tableParts` → sheet rels → `xl/tables/*.xml`. `filterButton` `colId` ile eşlenir, konumla değil |
| `get_conditional_formats` | worksheet `conditionalFormatting/cfRule`. `containsText` ailesi tip + operatöre ayrıştırılır. `cfvo type="formula"` eşiğinin ifadesi `formula` alanında korunur |
| `get_images` | worksheet `drawing` → sheet rels → `xl/drawings/*.xml` → `a:blip r:embed` → drawing rels → `xl/media/*`. `twoCell`, `oneCell` ve `absolute` anchor'ların üçü de raporlanır; absolute anchor'ın hücre aralığı yoktur, uydurmak yerine `range` alanı düşer |

Chart, pivot table ve sparkline hâlâ okunmaz — `capabilities` bloğu üçünü de her formatta `false` bildirir ve `get_images` bu türler açıkça istendiğinde `unsupported_object_kind` döner.

## Arama ve eşleştirme

`caseSensitive` kapalıyken eşleştirme büyük/küçük harf **ve aksan** duyarsızdır: `istanbul` sorgusu `İSTANBUL`'u, `sisli` sorgusu `ŞİŞLİ`'yi bulur. Katlama dil-bağımsızdır, Türkçe'ye özel tablo yoktur. `regex` modu katlanmaz.

## Limitler

Sabittir, yapılandırılamaz: dosya 50 MB (CSV 16 MB, 2M hücre) · yanıt 10.000 hücre (varsayılan 2.000) · 512 KB serialize · hücre başına 512 karakter · agregasyonda 50 grup (en fazla 500). Kesilen yanıt `truncated`, `truncationReason` ve `nextCursor` taşır; `nextCursor` doğrudan `read_sheet`'e geri verilir.

## Hatalar

Hatalar `isError: true` ile ve `{error, message, recovery}` gövdesiyle döner. `error` alanı makine-okunur bir koddur; `recovery` bir sonraki çağrının nasıl düzeltileceğini söyler.

Bozuk dosya iddiası üç ayrı koda bölünmüştür ve hiçbiri diğerinin yerine kullanılmaz:

| kod                  | ne zaman                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `not_a_workbook`     | bayt dizisi zip başlığıyla başlamıyor, ya da geçerli bir zip ama içinde workbook part'ı yok (`.docx`'in `.xlsx` diye adlandırılmış hali) |
| `encrypted_workbook` | OLE2/CFB başlığı — parola korumalı ya da eski ikili biçim                                                                                |
| `corrupt_workbook`   | zip geçerli, workbook part'ı var, ama parser çözemedi. Mesaj parser'ın kendi açıklamasını taşır                                          |

Sunucunun kendi kusurundan doğan, sınıflandırılamayan bir hata `internal_error` döner ve **`recovery` taşımaz** — bilinen bir "sonraki çağrı" yoktur, ve olmadığı halde varmış gibi yapmak ajanı sağlam bir dosyayı onarmaya yollar. Ham ayrıntı stderr'e yazılır.
