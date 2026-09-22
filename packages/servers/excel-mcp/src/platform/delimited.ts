export type DelimiterName = "comma" | "semicolon" | "tab" | "pipe";

export type EncodingName =
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "windows-1254"
  | "iso-8859-9"
  | "windows-1252";

export const delimiterNames: Readonly<Record<DelimiterName, string>> = {
  comma: ",",
  semicolon: ";",
  tab: "\t",
  pipe: "|",
};

export interface CsvOptions {
  readonly delimiter?: DelimiterName;
  readonly encoding?: EncodingName;
}
