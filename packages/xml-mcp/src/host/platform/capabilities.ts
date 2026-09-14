import type { SourceMode } from "@sk-mcp/file-core";
import type { DocumentFormat } from "./formats.js";

export interface XmlCapabilities {
  readonly namespaceAwareAddressing: boolean;
  readonly orderedMixedContent: boolean;
  readonly literalSearch: boolean;
  readonly xpath: boolean;
  readonly recordProjection: boolean;
  readonly aggregation: boolean;
  readonly schemaValidation: boolean;
  readonly streaming: boolean;
  readonly typeInference: boolean;
  readonly write: boolean;
  readonly nodeIdentity: boolean;
  readonly exactTotals: boolean;
  readonly randomAccessRead: boolean;
}

export const capabilities: Readonly<
  Record<DocumentFormat, Readonly<Record<SourceMode, XmlCapabilities>>>
> = {
  xml: {
    resident: {
      namespaceAwareAddressing: true,
      orderedMixedContent: true,
      literalSearch: true,
      xpath: true,
      recordProjection: true,
      aggregation: true,
      schemaValidation: false,
      streaming: false,
      typeInference: false,
      write: false,
      nodeIdentity: true,
      exactTotals: true,
      randomAccessRead: true,
    },
    chunked: {
      namespaceAwareAddressing: true,
      orderedMixedContent: true,
      literalSearch: false,
      xpath: false,
      recordProjection: true,
      aggregation: false,
      schemaValidation: false,
      streaming: false,
      typeInference: false,
      write: false,
      nodeIdentity: false,
      exactTotals: false,
      randomAccessRead: false,
    },
  },
};

export function capabilitiesFor(
  format: DocumentFormat,
  mode: SourceMode,
): XmlCapabilities {
  return capabilities[format][mode];
}
