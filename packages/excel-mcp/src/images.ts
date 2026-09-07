import type { Workbook, Worksheet } from "exceljs";
import { limits } from "./limits.js";
import { formatRectangle } from "./range.js";

export interface SheetImage {
  readonly imageId: number;
  readonly anchor: "oneCell" | "twoCell";
  readonly range: string;
  readonly extension?: string;
  readonly sizeBytes?: number;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly editAs?: string;
  readonly hyperlink?: string;
  readonly tooltip?: string;
}

export interface ImageReport {
  readonly sheet: string;
  readonly count: number;
  readonly images: readonly SheetImage[];
  readonly truncated: boolean;
  readonly truncationReason?: "maxImagesPerSheet";
  readonly hint?: string;
}

interface StoredAnchor {
  readonly nativeCol: number;
  readonly nativeColOff: number;
  readonly nativeRow: number;
  readonly nativeRowOff: number;
}

interface StoredImageRange {
  readonly tl?: StoredAnchor;
  readonly br?: StoredAnchor;
  readonly ext?: { readonly width?: number; readonly height?: number };
  readonly editAs?: string;
  readonly hyperlinks?: {
    readonly hyperlink?: string;
    readonly tooltip?: string;
  };
}

interface StoredImage {
  readonly imageId?: number;
  readonly range?: StoredImageRange;
}

interface StoredMedia {
  readonly extension?: string;
  readonly buffer?: { readonly length: number };
}

interface MediaHost {
  readonly media?: readonly StoredMedia[];
}

function sheetImagesOf(worksheet: Worksheet): readonly StoredImage[] {
  return worksheet.getImages() as unknown as readonly StoredImage[];
}

function mediaOf(workbook: Workbook): readonly StoredMedia[] {
  return (workbook as Workbook & MediaHost).media ?? [];
}

export function imageCountOf(worksheet: Worksheet): number {
  return sheetImagesOf(worksheet).length;
}

function occupiedRange(range: StoredImageRange | undefined): string {
  const topLeft = range?.tl;
  if (topLeft === undefined) {
    return "A1";
  }
  const top = topLeft.nativeRow + 1;
  const left = topLeft.nativeCol + 1;
  const bottomRight = range?.br;
  if (bottomRight === undefined) {
    return formatRectangle(top, left, top, left);
  }
  const bottom =
    bottomRight.nativeRowOff === 0
      ? bottomRight.nativeRow
      : bottomRight.nativeRow + 1;
  const right =
    bottomRight.nativeColOff === 0
      ? bottomRight.nativeCol
      : bottomRight.nativeCol + 1;
  return formatRectangle(
    top,
    left,
    Math.max(top, bottom),
    Math.max(left, right),
  );
}

function describe(
  image: StoredImage,
  media: readonly StoredMedia[],
): SheetImage {
  const range = image.range;
  const imageId = image.imageId ?? 0;
  const entry = media[imageId];
  const extent = range?.ext;
  const links = range?.hyperlinks;
  return {
    imageId,
    anchor: range?.br === undefined ? "oneCell" : "twoCell",
    range: occupiedRange(range),
    ...(entry?.extension === undefined ? {} : { extension: entry.extension }),
    ...(entry?.buffer === undefined ? {} : { sizeBytes: entry.buffer.length }),
    ...(extent?.width === undefined ? {} : { widthPx: extent.width }),
    ...(extent?.height === undefined ? {} : { heightPx: extent.height }),
    ...(range?.editAs === undefined ? {} : { editAs: range.editAs }),
    ...(links?.hyperlink === undefined ? {} : { hyperlink: links.hyperlink }),
    ...(links?.tooltip === undefined ? {} : { tooltip: links.tooltip }),
  };
}

export function collectImages(
  workbook: Workbook,
  worksheet: Worksheet,
): ImageReport {
  const found = sheetImagesOf(worksheet);
  const media = mediaOf(workbook);
  const truncated = found.length > limits.maxImagesPerSheet;
  const kept = truncated ? found.slice(0, limits.maxImagesPerSheet) : found;
  return {
    sheet: worksheet.name,
    count: found.length,
    images: kept.map((image) => describe(image, media)),
    truncated,
    ...(truncated
      ? {
          truncationReason: "maxImagesPerSheet" as const,
          hint: `${found.length} images are anchored on this sheet; the first ${limits.maxImagesPerSheet} are listed. Call describe_workbook for the count on every sheet.`,
        }
      : {}),
  };
}
