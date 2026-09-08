export interface MetadataLimitation {
  readonly code:
    | "absolute_anchor_images"
    | "formula_cf_thresholds"
    | "sheet_local_defined_names";
  readonly message: string;
  readonly followUp: string;
}
export const metadataLimitations = {
  images: {
    code: "absolute_anchor_images",
    message:
      "Only ExcelJS-supported image anchors are reported. Absolute anchors may be absent; zero is not proof of no images.",
    followUp: "EXCEL-META-009",
  },
  thresholds: {
    code: "formula_cf_thresholds",
    message:
      "ExcelJS does not preserve formula threshold text. Unsupported thresholds omit the numeric value.",
    followUp: "EXCEL-META-010",
  },
  definedNames: {
    code: "sheet_local_defined_names",
    message:
      "Sheet-local defined name scopes may be lost by ExcelJS. This is a partial list, not a complete scoped name registry.",
    followUp: "EXCEL-META-025",
  },
} as const satisfies Record<string, MetadataLimitation>;
