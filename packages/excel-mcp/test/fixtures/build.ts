import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
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
