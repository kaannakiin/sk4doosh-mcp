import type { DocumentFormat } from "./paths.js";

export interface FormatCapabilities {
  readonly merges: boolean;
  readonly dataValidations: boolean;
  readonly formulas: boolean;
  readonly numberFormats: boolean;
  readonly hyperlinks: boolean;
  readonly multipleSheets: boolean;
  readonly definedNames: boolean;
  readonly typedValues: boolean;
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
  },
};
