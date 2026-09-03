# @sk-mcp/excel-mcp

Ajanın yerel Excel dosyalarını **okuduğu** bağımsız bir MCP sunucusu. Yazma işlemi yoktur.

Okunan biçimler: `.xlsx`, `.xlsm`, `.csv`. Karar gerekçeleri ve semantik sözleşme: [karar 005](../../docs/kararlar/005-excel-okuma-semantikleri.md).

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

| Tool                   | İş                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `list_workbooks`       | Kök altındaki okunabilir dosyaları listeler. Döndürdüğü `filePath` diğer tool'lara aynen verilir |
| `describe_workbook`    | Sheet'ler, used range, merge/validation sayıları, formül önbellek kapsamı, tanımlı adlar         |
| `read_sheet`           | Hücre aralığını kompakt grid olarak okur: hoist edilmiş kolon başlıkları + satır dizileri        |
| `get_merged_ranges`    | Birleştirilmiş hücre aralıkları                                                                  |
| `get_data_validations` | Doğrulama kuralları, dikdörtgen aralıklara geri gruplanmış                                       |
| `find_in_sheet`        | Değere veya formüle göre hücre arar                                                              |

Büyük bir sheet'i `read_sheet` ile sayfalamak yerine `aggregate_sheet`, `find_in_sheet` veya dar bir `range` tercih edin; `describe_workbook` ve `read_sheet` bunu `guidance`/`hint` alanlarıyla söyler.

## CSV

Değerler **hiç yorumlanmaz**: `01234` string kalır, `03-04-2024` tarihe çevrilmez, `true` boolean olmaz. Ayraç sniff edilir ve her yanıtta `csv.delimiter` + `csv.delimiterSource` ile echo'lanır; iki aday eşitse `ambiguous_delimiter` döner ve `delimiter` parametresini istersiniz. Encoding BOM'dan çözülür, yoksa utf-8 denenir; Türkçe Excel çıktısı için `encoding: "windows-1254"` verin.

CSV'nin taşıyamadığı bir şey açıkça istenirse (`valueMode`, `mergedCells: "repeat"`, `includeHyperlinks`, `get_merged_ranges`, `get_data_validations`) `unsupported_for_format` döner — boş sonuç değil. `describe_workbook` hangi yeteneklerin mevcut olduğunu `capabilities` bloğunda önceden bildirir.

## Arama ve eşleştirme

`caseSensitive` kapalıyken eşleştirme büyük/küçük harf **ve aksan** duyarsızdır: `istanbul` sorgusu `İSTANBUL`'u, `sisli` sorgusu `ŞİŞLİ`'yi bulur. Katlama dil-bağımsızdır, Türkçe'ye özel tablo yoktur. `regex` modu katlanmaz.

## Limitler

Sabittir, yapılandırılamaz: dosya 50 MB (CSV 16 MB, 2M hücre) · yanıt 10.000 hücre (varsayılan 2.000) · 512 KB serialize · hücre başına 512 karakter · agregasyonda 50 grup (en fazla 500). Kesilen yanıt `truncated`, `truncationReason` ve `nextCursor` taşır; `nextCursor` doğrudan `read_sheet`'e geri verilir.

## Hatalar

Hatalar `isError: true` ile ve `{error, message, recovery}` gövdesiyle döner. `error` alanı makine-okunur bir koddur; `recovery` bir sonraki çağrının nasıl düzeltileceğini söyler.
