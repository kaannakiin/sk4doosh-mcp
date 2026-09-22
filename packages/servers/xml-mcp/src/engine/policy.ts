import { ParseOption } from "libxml2-wasm";

export const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

export const forbiddenParseOptions = [
  "XML_PARSE_NOBLANKS",
  "XML_PARSE_NOCDATA",
  "XML_PARSE_HUGE",
  "XML_PARSE_RECOVER",
  "XML_PARSE_DTDLOAD",
  "XML_PARSE_DTDATTR",
  "XML_PARSE_DTDVALID",
  "XML_PARSE_XINCLUDE",
  "XML_PARSE_NOENT",
] as const;
