export type Delimiter = "," | ";" | "\t";

export interface CsvTable {
  readonly header: string;
  readonly rows: readonly string[];
  readonly delimiter: Delimiter;
}

const delimiters: readonly Delimiter[] = [",", ";", "\t"];

/**
 * Splits CSV text into raw records, leaving each record's text untouched.
 *
 * Guard: a line break inside a quoted field belongs to the record, so splitting
 * on newlines alone would cut such a row in two and shift every label after
 * it. The raw text is kept because the model sees it and the output repeats it
 * verbatim, with only the label appended.
 */
export function splitRecords(text: string): readonly string[] {
  const records: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "\n" && !quoted) {
      records.push(text.slice(start, index).replace(/\r$/u, ""));
      start = index + 1;
    }
  }
  records.push(text.slice(start).replace(/\r$/u, ""));
  return records.filter((record) => record.trim() !== "");
}

function countOutsideQuotes(record: string, target: string): number {
  let quoted = false;
  let count = 0;
  for (const char of record) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === target && !quoted) {
      count += 1;
    }
  }
  return count;
}

export function delimiterOf(header: string): Delimiter {
  return delimiters.reduce((best, candidate) =>
    countOutsideQuotes(header, candidate) > countOutsideQuotes(header, best)
      ? candidate
      : best,
  );
}

export function fieldsOf(
  record: string,
  delimiter: Delimiter,
): readonly string[] {
  const fields: string[] = [];
  let quoted = false;
  let current = "";
  for (let index = 0; index < record.length; index += 1) {
    const char = record[index];
    if (char === '"') {
      if (quoted && record[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function csvField(value: string, delimiter: Delimiter): string {
  return value.includes('"') ||
    value.includes(delimiter) ||
    value.includes("\n") ||
    value.includes("\r")
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

export function parseTable(text: string): CsvTable | undefined {
  const [header, ...rows] = splitRecords(text);
  return header === undefined
    ? undefined
    : { header, rows, delimiter: delimiterOf(header) };
}
