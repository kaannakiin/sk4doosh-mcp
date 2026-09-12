import {
  EXTENSION_BY_MEDIA_TYPE,
  type SupportedMediaType,
} from "@chat/contracts/attachment/media-type";
import {
  IconFileSpreadsheet,
  IconFileTypeCsv,
  IconFileTypeXml,
  IconPaperclip,
  IconPhoto,
} from "@tabler/icons-react";
import { createElement } from "react";

/**
 * Guard: keyed on the extension the contract already derives from the media
 * type, not on a second parse of the filename. A file arrives named whatever the
 * visitor called it, and the stored media type is what the readers dispatch on —
 * an icon chosen from the name can disagree with the tool that opens it.
 */
const BY_EXTENSION: Readonly<Record<string, typeof IconPaperclip>> = {
  xlsx: IconFileSpreadsheet,
  xlsm: IconFileSpreadsheet,
  csv: IconFileTypeCsv,
  xml: IconFileTypeXml,
  png: IconPhoto,
  jpg: IconPhoto,
  webp: IconPhoto,
  gif: IconPhoto,
};

/**
 * Guard: built with `createElement` rather than by assigning the looked-up icon
 * to a capitalised local and rendering it as jsx. Both read the same frozen map,
 * but `react-hooks/static-components` cannot tell a lookup from a component
 * declared during render and flags the jsx form.
 */
export function AttachmentGlyph({
  mediaType,
  size = 15,
}: Readonly<{ mediaType: SupportedMediaType; size?: number }>) {
  return createElement(
    BY_EXTENSION[EXTENSION_BY_MEDIA_TYPE[mediaType]] ?? IconPaperclip,
    { size, className: "shrink-0 text-accent" },
  );
}
