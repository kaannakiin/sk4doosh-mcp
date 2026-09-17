import type { OoxmlErrorCode, OoxmlErrorFactory } from "@sk-mcp/ooxml-core";
import { SkMcpExcelError, type SkMcpExcelErrorCode } from "../platform/errors.js";

interface Mapping {
  readonly code: SkMcpExcelErrorCode;
  readonly recovery: string;
}

const reSave = "Open the file in Excel and re-save it as .xlsx.";

const mappings: Readonly<Record<OoxmlErrorCode, Mapping>> = {
  not_a_package: { code: "not_a_workbook", recovery: reSave },
  legacy_binary_container: {
    code: "encrypted_workbook",
    recovery: "Save an unprotected copy in .xlsx format.",
  },
  corrupt_package: { code: "corrupt_workbook", recovery: reSave },
  unsupported_zip_feature: { code: "corrupt_workbook", recovery: reSave },
  malformed_part_name: { code: "corrupt_workbook", recovery: reSave },
  unsupported_part_encoding: { code: "corrupt_workbook", recovery: reSave },
  part_too_large: {
    code: "file_too_large",
    recovery: "Split the sheet, or read a narrower range.",
  },
  package_too_large: {
    code: "file_too_large",
    recovery: "Split the sheet, or read a narrower range.",
  },
};

/**
 * Translates a container failure into this server's vocabulary. The core states
 * the fact and knows no spreadsheet nouns; the code and the recovery advice are
 * chosen here, which is the only place they belong.
 */
export const failOoxml: OoxmlErrorFactory = (code, message) => {
  const mapping = mappings[code];
  return new SkMcpExcelError(mapping.code, message, mapping.recovery);
};
