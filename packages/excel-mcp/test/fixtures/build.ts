import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { DataValidation, Worksheet } from "exceljs";

interface ValidationWriter {
  readonly dataValidations: { add(range: string, rule: DataValidation): void };
}

function validationsOn(
  worksheet: Worksheet,
): ValidationWriter["dataValidations"] {
  return (worksheet as Worksheet & ValidationWriter).dataValidations;
}

export interface Fixtures {
  readonly root: string;
  readonly sample: string;
  readonly validations: string;
  readonly large: string;
  readonly empty: string;
  readonly longStrings: string;
  readonly wide: string;
  readonly turkish: string;
  readonly csvDir: string;
  readonly parity: string;
  readonly analysis: string;
  readonly corrupt: string;
  readonly encrypted: string;
  readonly titleBand: string;
  readonly truncated: string;
  readonly flipped: string;
  readonly notAWorkbook: string;
  readonly facets: string;
  readonly prefixed: string;
  readonly unnumberedSheet: string;
}

export const largeRowCount = 20_000;

const windows1254: Readonly<Record<string, number>> = {
  Ğ: 0xd0,
  ğ: 0xf0,
  İ: 0xdd,
  ı: 0xfd,
  Ş: 0xde,
  ş: 0xfe,
  Ç: 0xc7,
  ç: 0xe7,
  Ö: 0xd6,
  ö: 0xf6,
  Ü: 0xdc,
  ü: 0xfc,
};

function toWindows1254(text: string): Buffer {
  return Buffer.from(
    [...text].map((character) => {
      const mapped = windows1254[character];
      if (mapped !== undefined) {
        return mapped;
      }
      const code = character.codePointAt(0) ?? 0;
      if (code > 0x7f) {
        throw new Error(`unmapped character ${character}`);
      }
      return code;
    }),
  );
}

const csvFiles: Readonly<Record<string, Buffer>> = {
  "simple.csv": Buffer.from(
    [
      "kod,posta,lot,durum,not",
      "03-04-2024,01234,007,true,#N/A",
      "12-31-2023,06510,1e5,false,metin",
    ].join("\n"),
    "utf8",
  ),
  "turkce.csv": toWindows1254(
    ["Şehir;İlçe;Posta", "İSTANBUL;ŞİŞLİ;34380", "Ankara;Çankaya;06510"].join(
      "\n",
    ),
  ),
  "bom.csv": Buffer.concat([
    Buffer.from("efbbbf", "hex"),
    Buffer.from("kod,ad\n1,bir", "utf8"),
  ]),
  "ragged.csv": Buffer.from("a,b,c\n1,2\n3,4,5,6\n7,8,9", "utf8"),
  "quoted.csv": Buffer.from(
    'ad,not\n"iki\nsatir","o ""dedi"""\nson,tek',
    "utf8",
  ),
  "ambiguous.csv": Buffer.from("a;b,c\nd;e,f\ng;h,i", "utf8"),
  "single-column.csv": Buffer.from("kod\n123\n456", "utf8"),
  "header-only.csv": Buffer.from("a,b,c", "utf8"),
  "blank-lines.csv": Buffer.from("a,b\n1,2\n\n3,4", "utf8"),
  "formulas.csv": Buffer.from("ad,tutar\n=SUM(A1:A2),-5\nnormal,10", "utf8"),
  "dupes.csv": Buffer.from("tutar,ad,tutar\n1,x,2", "utf8"),
  "crlf.csv": Buffer.from("a,b\r\n1,2\r\n", "utf8"),
  "utf16.csv": Buffer.from("a,b\n1,2", "utf16le"),
  "empty.csv": Buffer.alloc(0),
  "big.csv": Buffer.from(
    [
      "id,name,amount",
      ...Array.from(
        { length: 999 },
        (_, index) => `${index + 1},name-${index + 1},${(index + 1) * 3}`,
      ),
    ].join("\n"),
    "utf8",
  ),
};

async function buildCsv(dir: string): Promise<void> {
  await mkdir(dir);
  for (const [name, bytes] of Object.entries(csvFiles)) {
    await writeFile(join(dir, name), bytes);
  }
}

async function buildSample(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Q1");
  sheet.addRow(["Region", "Units", "Price", "Total", "Zero", "Share"]);
  for (let index = 0; index < 4; index += 1) {
    const row = index + 2;
    sheet.addRow([`EMEA${index}`, index + 1, 19.99]);
    sheet.getCell(`C${row}`).numFmt = "$#,##0.00";
    sheet.getCell(`D${row}`).value = {
      formula: `B${row}*C${row}`,
      result: Number(((index + 1) * 19.99).toFixed(2)),
    };
    sheet.getCell(`E${row}`).value = { formula: `D${row}-D${row}`, result: 0 };
    sheet.getCell(`F${row}`).value = 0.15;
    sheet.getCell(`F${row}`).numFmt = "0%";
  }
  sheet.getCell("A7").value = new Date(Date.UTC(2026, 0, 15));
  sheet.getCell("A7").numFmt = "yyyy-mm-dd";
  sheet.getCell("B7").value = new Date(Date.UTC(2026, 0, 15, 9, 30));
  sheet.getCell("B7").numFmt = "yyyy-mm-dd hh:mm";
  sheet.getCell("C7").value = { error: "#DIV/0!" };
  sheet.getCell("D7").value = { richText: [{ text: "ri" }, { text: "ch" }] };
  sheet.getCell("E7").value = {
    text: "Docs",
    hyperlink: "https://example.test/doc",
  };
  sheet.getCell("F7").value = "";
  sheet.getCell("A8").value = { formula: "NOCACHE()" };
  sheet.mergeCells("A10:C10");
  sheet.getCell("A10").value = "merged";
  for (let row = 20; row <= 5000; row += 1) {
    sheet.getRow(row).height = 18;
  }
  const notes = workbook.addWorksheet("Notes");
  notes.state = "hidden";
  await workbook.xlsx.writeFile(path);
}

async function buildValidations(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.getCell("A1").value = "seed";
  const list: DataValidation = {
    type: "list",
    allowBlank: true,
    formulae: ['"x,y"'],
  };
  validationsOn(sheet).add("A2:A5000", { ...list });
  validationsOn(sheet).add("C2:C10", { ...list });
  validationsOn(sheet).add("E2:E10", {
    type: "whole",
    operator: "greaterThan",
    allowBlank: false,
    formulae: [0],
  });
  await workbook.xlsx.writeFile(path);
}

async function buildLarge(path: string): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path });
  const sheet = workbook.addWorksheet("Big");
  sheet.addRow(["id", "name", "amount"]).commit();
  for (let row = 2; row <= largeRowCount; row += 1) {
    sheet.addRow([row - 1, `name-${row - 1}`, (row - 1) * 3]).commit();
  }
  sheet.commit();
  await workbook.commit();
}

async function buildWide(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Grid");
  const headers: string[] = [];
  for (let column = 0; column < 20; column += 1) {
    headers.push(`column_${column + 1}`);
  }
  sheet.addRow(headers);
  for (let row = 0; row < 49; row += 1) {
    const line: (string | number | Date)[] = [];
    for (let column = 0; column < 20; column += 1) {
      if (column % 4 === 0) {
        line.push(`region-${row}-${column}`);
      } else if (column % 4 === 1) {
        line.push(row * 100 + column);
      } else if (column % 4 === 2) {
        line.push(Number((row * 1.37 + column).toFixed(2)));
      } else {
        line.push(new Date(Date.UTC(2026, 0, 1 + (row % 28))));
      }
    }
    const added = sheet.addRow(line);
    for (let column = 4; column <= 20; column += 4) {
      added.getCell(column).numFmt = "yyyy-mm-dd";
    }
  }
  await workbook.xlsx.writeFile(path);
}

async function buildTurkish(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Şubeler");
  sheet.addRow(["Şehir", "İlçe", "Not"]);
  sheet.addRow(["İSTANBUL", "ŞİŞLİ", "ÖĞRENCİ indirimi"]);
  sheet.addRow(["ıstanbul", "Şişli", "straße"]);
  sheet.addRow(["Ankara", "Çankaya", "normal"]);
  sheet.getCell("A6").value = `${"x".repeat(511)}\u{1F600}`;
  workbook.addWorksheet("Diğer");
  await workbook.xlsx.writeFile(path);
}

async function buildParity(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["kod", "posta", "lot", "durum", "not"]);
  sheet.addRow(["03-04-2024", "01234", "007", "true", "#N/A"]);
  sheet.addRow(["12-31-2023", "06510", "1e5", "false", "metin"]);
  await workbook.xlsx.writeFile(path);
}

async function buildAnalysis(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sales");
  sheet.addRow(["Region", "Total", "Date", "B", "Total", "", "2026", "Amount"]);
  const regions = ["İSTANBUL", "istanbul", "Ankara", "Ankara", "İzmir", "Bos"];
  const totals: (
    number | string | { error: string } | boolean | Date | null
  )[] = [10, "12", 20.5, { error: "#DIV/0!" }, true, null];
  for (let index = 0; index < regions.length; index += 1) {
    const row = index + 2;
    sheet.getCell(`A${row}`).value = regions[index] ?? null;
    sheet.getCell(`B${row}`).value = totals[index] as ExcelJS.CellValue;
    sheet.getCell(`C${row}`).value = new Date(Date.UTC(2026, 0, 10 + index));
    sheet.getCell(`C${row}`).numFmt = "yyyy-mm-dd";
    sheet.getCell(`D${row}`).value = index;
    sheet.getCell(`E${row}`).value = index * 2;
    sheet.getCell(`H${row}`).value =
      ["1234.50", "007", "1.234,56", "x", "8", "9"][index] ?? null;
  }
  sheet.getCell("B8").value = { formula: "SUM(B2:B7)" };
  sheet.getCell("A8").value = "Ankara";

  const floats = workbook.addWorksheet("Floats");
  floats.addRow(["small", "mixed"]);
  for (let row = 2; row <= 501; row += 1) {
    floats.getCell(`A${row}`).value = 0.1;
    floats.getCell(`B${row}`).value = row % 100 === 0 ? 1e9 : 0.001;
  }

  const merged = workbook.addWorksheet("Merged");
  merged.addRow(["Region", "Total"]);
  merged.getCell("A2").value = "EMEA";
  merged.getCell("B2").value = 1;
  merged.getCell("B3").value = 2;
  merged.getCell("B4").value = 3;
  merged.mergeCells("A2:A4");
  await workbook.xlsx.writeFile(path);
}

async function buildEmpty(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Blank");
  await workbook.xlsx.writeFile(path);
}

async function buildLongStrings(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Long");
  sheet.addRow(["a", "b"]);
  for (let row = 2; row <= 1500; row += 1) {
    sheet.addRow(["x".repeat(400), "y".repeat(400)]);
  }
  await workbook.xlsx.writeFile(path);
}

async function buildTitleBand(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  const invoices = workbook.addWorksheet("Faturalar");
  invoices.getCell("A1").value = "Kapanmamış Faturalar";
  invoices.mergeCells("A1:G1");
  invoices.getRow(3).values = [
    "Fatura Tarihi",
    "Vade Tarihi",
    "Fatura No",
    "Tutar",
    "Ödenen Tutar",
    "Kalan Tutar",
    "Kalan Gün",
  ];
  for (let index = 0; index < 6; index += 1) {
    invoices.getRow(index + 4).values = [
      "06.04.2026",
      "05.06.2026",
      `ORA${index + 1}`,
      (index + 1) * 1000,
      0,
      (index + 1) * 1000 - 0.37,
      -94 + index,
    ];
  }

  const allText = workbook.addWorksheet("AllText");
  for (let row = 1; row <= 4; row += 1) {
    allText.getRow(row).values = [`a${row}`, `b${row}`, `c${row}`];
  }

  const noHeader = workbook.addWorksheet("NoHeader");
  for (let row = 1; row <= 4; row += 1) {
    noHeader.getRow(row).values = [row, row * 2, row * 3];
  }

  const declared = workbook.addWorksheet("Declared");
  declared.getCell("A1").value = "Başlık Bandı";
  declared.mergeCells("A1:C1");
  declared.addTable({
    name: "Faturalar",
    ref: "A3",
    columns: [{ name: "Fatura No" }, { name: "Tutar" }, { name: "Kalan" }],
    rows: [
      ["ORA1", 100, 50],
      ["ORA2", 200, 60],
    ],
  });

  const twoRow = workbook.addWorksheet("IkiSatir");
  twoRow.getCell("A1").value = "Bolge";
  twoRow.mergeCells("A1:A2");
  twoRow.getCell("B1").value = "Ceyrek 1";
  twoRow.mergeCells("B1:C1");
  twoRow.getCell("B2").value = "Ocak";
  twoRow.getCell("C2").value = "Subat";
  twoRow.getCell("D1").value = "Toplam";
  twoRow.mergeCells("D1:D2");
  for (let row = 3; row <= 5; row += 1) {
    twoRow.getRow(row).values = ["EMEA", row, row * 2, row * 3];
  }

  const mergedHeader = workbook.addWorksheet("MergedHeader");
  mergedHeader.getCell("A1").value = "Toplam";
  mergedHeader.mergeCells("A1:B1");
  mergedHeader.getCell("C1").value = "Ad";
  for (let row = 2; row <= 4; row += 1) {
    mergedHeader.getRow(row).values = [row, row * 10, `ad-${row}`];
  }

  await workbook.xlsx.writeFile(path);
}

async function buildMalformed(
  truncated: string,
  flipped: string,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.addRow(["id", "name"]);
  for (let row = 2; row <= 40; row += 1) {
    sheet.addRow([row - 1, `name-${row - 1}`]);
  }
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  await writeFile(truncated, buffer.subarray(0, Math.floor(buffer.length / 2)));

  const bits = Buffer.from(buffer);
  for (let offset = 400; offset < 440 && offset < bits.length; offset += 1) {
    bits[offset] = (bits[offset] ?? 0) ^ 0xff;
  }
  await writeFile(flipped, bits);
}

async function buildNotAWorkbook(path: string): Promise<void> {
  const name = Buffer.from("word/document.xml", "utf8");
  const body = Buffer.from(
    "<document><body>not a spreadsheet</body></document>",
    "utf8",
  );
  const sum = crc32(body);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(sum, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(sum, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);

  const centralSize = central.length + name.length;
  const offset = local.length + name.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  await writeFile(path, Buffer.concat([local, name, body, central, name, end]));
}

const onePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/2gAAAABJRU5ErkJggg==";

async function buildFacets(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  const tables = workbook.addWorksheet("Tablolar");
  tables.addTable({
    name: "Faturalar",
    displayName: "Faturalar",
    ref: "A1",
    totalsRow: true,
    columns: [
      { name: "Fatura No", filterButton: true },
      { name: "Tutar", totalsRowFunction: "sum" },
      { name: "Kalan" },
    ],
    rows: [
      ["ORA1", 100, 50],
      ["ORA2", 200, 60],
    ],
  });
  tables.addTable({
    name: "Kalemler",
    displayName: "Kalemler",
    ref: "E1",
    columns: [{ name: "Kalem" }, { name: "Adet" }],
    rows: [["Kalem A", 3]],
  });
  tables.autoFilter = "A1:C4";
  tables.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

  const conditional = workbook.addWorksheet("Kosullu");
  conditional.getCell("B2").value = 1500;
  conditional.getCell("C2").value = 40;
  conditional.addConditionalFormatting({
    ref: "B2:B20 D2:D20",
    rules: [
      {
        type: "cellIs",
        operator: "greaterThan",
        priority: 1,
        formulae: [1000],
        style: {
          fill: {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFF0000" },
          },
        },
      },
      {
        type: "expression",
        priority: 2,
        formulae: ["$B2>$C2"],
        style: { font: { bold: true } },
      },
    ],
  });
  conditional.addConditionalFormatting({
    ref: "C2:C20",
    rules: [
      {
        type: "colorScale",
        priority: 3,
        cfvo: [{ type: "min" }, { type: "percentile", value: 90 }],
        color: [{ argb: "FFFFFFFF" }, { argb: "FF00FF00" }],
      },
      {
        type: "dataBar",
        priority: 4,
        cfvo: [{ type: "min" }, { type: "max" }],
      },
      {
        type: "iconSet",
        priority: 5,
        iconSet: "3TrafficLights1",
        cfvo: [
          { type: "percent", value: 0 },
          { type: "percent", value: 33 },
          { type: "percent", value: 67 },
        ],
      },
    ],
  });

  const pictures = workbook.addWorksheet("Resimler");
  pictures.getCell("A1").value = "kapak";
  const imageId = workbook.addImage({
    base64: onePixelPng,
    extension: "png",
  });
  pictures.addImage(imageId, "C3:F8");
  pictures.addImage(imageId, {
    tl: { col: 8, row: 2 },
    ext: { width: 64, height: 48 },
  });

  const bare = workbook.addWorksheet("Bos");
  bare.getCell("A1").value = "tek";

  await workbook.xlsx.writeFile(path);
}


const sharedStringValues = ["Ürün", "Adet", "Kalem", "Defter", "Toplam"];

function opcParts(prefix: string, sheetPart: string): Record<string, string> {
  const q = prefix === "" ? "" : `${prefix}:`;
  const xmlns = prefix === "" ? 'xmlns=' : `xmlns:${prefix}=`;
  const main = `${xmlns}"http://schemas.openxmlformats.org/spreadsheetml/2006/main"`;
  const strings = sharedStringValues
    .map((text) => `<${q}si><${q}t>${text}</${q}t></${q}si>`)
    .join("");
  const row = (index: number, cells: string) =>
    `<${q}row r="${index}">${cells}</${q}row>`;
  const shared = (ref: string, id: number) =>
    `<${q}c r="${ref}" t="s"><${q}v>${id}</${q}v></${q}c>`;
  const number = (ref: string, value: number) =>
    `<${q}c r="${ref}"><${q}v>${value}</${q}v></${q}c>`;
  return {
    "_rels/.rels":
      '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="rIdDoc" />' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="/docProps/app.xml" Id="rIdApp" />' +
      '<Relationship Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="/package/services/metadata/core-properties/core.psmdcp" Id="rIdCore" />' +
      "</Relationships>",
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="utf-8"?><${q}workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ${main}>` +
      `<${q}sheets><${q}sheet name="Veri" sheetId="1" r:id="rIdSheet" /></${q}sheets></${q}workbook>`,
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/${sheetPart}" Id="rIdSheet" />` +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml" Id="rIdStrings" />' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="/xl/styles.xml" Id="rIdStyles" />' +
      "</Relationships>",
    "xl/sharedStrings.xml":
      `<?xml version="1.0" encoding="utf-8"?><${q}sst ${main} count="${sharedStringValues.length}" uniqueCount="${sharedStringValues.length}">${strings}</${q}sst>`,
    "xl/styles.xml":
      `<?xml version="1.0" encoding="utf-8"?><${q}styleSheet ${main}>` +
      `<${q}fonts count="1"><${q}font /></${q}fonts><${q}fills count="1"><${q}fill /></${q}fills>` +
      `<${q}borders count="1"><${q}border /></${q}borders>` +
      `<${q}cellStyleXfs count="1"><${q}xf /></${q}cellStyleXfs><${q}cellXfs count="1"><${q}xf /></${q}cellXfs></${q}styleSheet>`,
    [sheetPart]:
      `<?xml version="1.0" encoding="utf-8"?><${q}worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ${main}>` +
      `<${q}dimension ref="A1:B5" /><${q}sheetData>` +
      row(1, shared("A1", 0) + shared("B1", 1)) +
      row(2, shared("A2", 2) + number("B2", 12)) +
      row(3, shared("A3", 3) + number("B3", 7)) +
      row(5, shared("A5", 4)) +
      `</${q}sheetData><${q}mergeCells count="1"><${q}mergeCell ref="A5:B5" /></${q}mergeCells>` +
      `<${q}conditionalFormatting sqref="B1:B3">` +
      `<${q}cfRule type="cellIs" dxfId="0" priority="2" operator="greaterThan"><${q}formula>10</${q}formula></${q}cfRule>` +
      `<${q}cfRule type="colorScale" priority="1"><${q}colorScale>` +
      `<${q}cfvo type="min" /><${q}cfvo type="formula" val="AVERAGE($B$1:$B$3)" /><${q}cfvo type="max" />` +
      `</${q}colorScale></${q}cfRule></${q}conditionalFormatting>` +
      `<${q}dataValidations count="1"><${q}dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Hata" error="Listeden seçin" sqref="A2:A3">` +
      `<${q}formula1>&quot;Kalem,Defter&quot;</${q}formula1></${q}dataValidation></${q}dataValidations>` +
      `<${q}drawing r:id="rIdDrawing" />` +
      `<${q}tableParts count="1"><${q}tablePart r:id="rIdTable" /></${q}tableParts></${q}worksheet>`,
    [`${sheetPart.replace(/([^/]+)$/, "_rels/$1.rels")}`]:
      '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="/xl/tables/table1.xml" Id="rIdTable" />' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml" Id="rIdDrawing" />' +
      "</Relationships>",
    "xl/drawings/_rels/drawing1.xml.rels":
      '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="/xl/media/image1.png" Id="rIdImage" />' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ornek.test/urun" TargetMode="External" Id="rIdLink" />' +
      "</Relationships>",
    "xl/drawings/drawing1.xml":
      '<?xml version="1.0" encoding="utf-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<xdr:twoCellAnchor editAs="oneCell">' +
      "<xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>" +
      "<xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>" +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Resim"><a:hlinkClick r:id="rIdLink" tooltip="Ürün sayfası" /></xdr:cNvPr><xdr:cNvPicPr /></xdr:nvPicPr>' +
      '<xdr:blipFill><a:blip r:embed="rIdImage" /></xdr:blipFill>' +
      '<xdr:spPr><a:xfrm><a:off x="0" y="0" /><a:ext cx="0" cy="0" /></a:xfrm></xdr:spPr></xdr:pic><xdr:clientData />' +
      "</xdr:twoCellAnchor>" +
      '<xdr:absoluteAnchor><xdr:pos x="0" y="0" /><xdr:ext cx="1143000" cy="762000" />' +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Mutlak" /><xdr:cNvPicPr /></xdr:nvPicPr>' +
      '<xdr:blipFill><a:blip r:embed="rIdImage" /></xdr:blipFill><xdr:spPr /></xdr:pic><xdr:clientData />' +
      "</xdr:absoluteAnchor></xdr:wsDr>",
    "xl/tables/table1.xml":
      `<?xml version="1.0" encoding="utf-8"?><${q}table ${main} id="1" name="Kalemler" displayName="Kalemler" ref="A1:B3" headerRowCount="1" totalsRowCount="0">` +
      `<${q}autoFilter ref="A1:B3"><${q}filterColumn colId="1" hiddenButton="0" /></${q}autoFilter>` +
      `<${q}tableColumns count="2"><${q}tableColumn id="1" name="Ürün" /><${q}tableColumn id="2" name="Adet" /></${q}tableColumns></${q}table>`,
    "docProps/app.xml":
      '<?xml version="1.0" encoding="utf-8"?><ap:Properties xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes" xmlns:ap="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      "<ap:Application>SystemSoft Reporting</ap:Application><ap:DocSecurity>0</ap:DocSecurity></ap:Properties>",
    "package/services/metadata/core-properties/core.psmdcp":
      '<?xml version="1.0" encoding="utf-8"?><coreProperties xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://schemas.openxmlformats.org/package/2006/metadata/core-properties">' +
      "<dc:creator>fixture</dc:creator></coreProperties>",
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />' +
      '<Default Extension="psmdcp" ContentType="application/vnd.openxmlformats-package.core-properties+xml" />' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />' +
      `<Override PartName="/${sheetPart}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />` +
      '<Default Extension="png" ContentType="image/png" />' +
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml" />' +
      '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" />' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" />' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" />' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml" />' +
      "</Types>",
  };
}

/**
 * Two workbook layouts ExcelJS cannot read but Excel opens without complaint:
 * a prefixed SpreadsheetML namespace (every .NET DocumentFormat.OpenXml
 * writer) and a worksheet part with no ordinal in its name (SpreadsheetLight).
 * Both are valid OPC, so a reader that rejects them is the defect.
 */
async function buildOpc(
  path: string,
  prefix: string,
  sheetPart: string,
): Promise<void> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(opcParts(prefix, sheetPart))) {
    zip.file(name, body);
  }
  zip.file("xl/media/image1.png", Buffer.from(onePixelPng, "base64"));
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

export async function buildFixtures(): Promise<Fixtures> {
  const root = await mkdtemp(join(tmpdir(), "sk-mcp-excel-"));
  await mkdir(join(root, "q1"));
  const fixtures: Fixtures = {
    root,
    sample: join(root, "q1", "sample.xlsx"),
    validations: join(root, "validations.xlsx"),
    large: join(root, "large.xlsx"),
    empty: join(root, "empty.xlsx"),
    longStrings: join(root, "long-strings.xlsx"),
    wide: join(root, "wide.xlsx"),
    turkish: join(root, "turkish.xlsx"),
    csvDir: join(root, "csv"),
    parity: join(root, "parity.xlsx"),
    analysis: join(root, "analysis.xlsx"),
    corrupt: join(root, "corrupt.xlsx"),
    encrypted: join(root, "encrypted.xlsx"),
    titleBand: join(root, "title-band.xlsx"),
    truncated: join(root, "truncated.xlsx"),
    flipped: join(root, "flipped.xlsx"),
    notAWorkbook: join(root, "not-a-workbook.xlsx"),
    facets: join(root, "facets.xlsx"),
    prefixed: join(root, "prefixed.xlsx"),
    unnumberedSheet: join(root, "unnumbered-sheet.xlsx"),
  };
  await buildSample(fixtures.sample);
  await buildValidations(fixtures.validations);
  await buildLarge(fixtures.large);
  await buildEmpty(fixtures.empty);
  await buildLongStrings(fixtures.longStrings);
  await buildWide(fixtures.wide);
  await buildTurkish(fixtures.turkish);
  await buildCsv(fixtures.csvDir);
  await buildParity(fixtures.parity);
  await buildAnalysis(fixtures.analysis);
  await buildTitleBand(fixtures.titleBand);
  await buildMalformed(fixtures.truncated, fixtures.flipped);
  await buildNotAWorkbook(fixtures.notAWorkbook);
  await buildFacets(fixtures.facets);
  await buildOpc(fixtures.prefixed, "x", "xl/worksheets/sheet1.xml");
  await buildOpc(fixtures.unnumberedSheet, "", "xl/worksheets/sheet.xml");
  await writeFile(
    fixtures.corrupt,
    Buffer.from("not a spreadsheet at all", "utf8"),
  );
  await writeFile(
    fixtures.encrypted,
    Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.alloc(512)]),
  );
  return fixtures;
}
