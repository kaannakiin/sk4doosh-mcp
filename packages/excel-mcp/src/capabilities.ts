import type { DocumentFormat } from "./formats.js";

export interface FormatCapabilities {
  readonly merges: boolean;
  readonly dataValidations: boolean;
  readonly formulas: boolean;
  readonly numberFormats: boolean;
  readonly hyperlinks: boolean;
  readonly multipleSheets: boolean;
  readonly definedNames: boolean;
  readonly typedValues: boolean;
  readonly headerScan: boolean;
  readonly tables: boolean;
  readonly conditionalFormats: boolean;
  readonly images: boolean;
  readonly charts: boolean;
  readonly pivotTables: boolean;
  readonly sparklines: boolean;
}

export const capabilities: Readonly<
  Record<DocumentFormat, FormatCapabilities>
> = {
  xlsx: {
    merges: true,
    dataValidations: true,
    formulas: true,
    numberFormats: true,
    hyperlinks: true,
    multipleSheets: true,
    definedNames: true,
    typedValues: true,
    headerScan: true,
    tables: true,
    conditionalFormats: true,
    images: true,
    charts: false,
    pivotTables: false,
    sparklines: false,
  },
  csv: {
    merges: false,
    dataValidations: false,
    formulas: false,
    numberFormats: false,
    hyperlinks: false,
    multipleSheets: false,
    definedNames: false,
    typedValues: false,
    headerScan: false,
    tables: false,
    conditionalFormats: false,
    images: false,
    charts: false,
    pivotTables: false,
    sparklines: false,
  },
};
