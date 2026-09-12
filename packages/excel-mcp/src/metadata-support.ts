export interface MetadataLimitation {
  readonly code:
    | "formula_cf_thresholds"
    | "sheet_local_defined_names";
  readonly message: string;
  readonly followUp: string;
}
export const metadataLimitations = {
  thresholds: {
    code: "formula_cf_thresholds",
    message:
      "A conditional-format threshold whose value is not a finite number is reported without one.",
    followUp: "EXCEL-META-010",
  },
  definedNames: {
    code: "sheet_local_defined_names",
    message:
      "Sheet-local defined name scopes may be lost. This is a partial list, not a complete scoped name registry.",
    followUp: "EXCEL-META-025",
  },
} as const satisfies Record<string, MetadataLimitation>;
