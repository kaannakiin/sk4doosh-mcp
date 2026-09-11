import { z } from "zod";

export const workbookPathSchema = z
  .string()
  .min(1)
  .describe("Attachment path exactly as listed in the attachment manifest.");

export const sheetNameSchema = z
  .string()
  .optional()
  .describe(
    "Case-sensitive worksheet name. Defaults to the first visible sheet.",
  );

export const columnRefSchema = z
  .string()
  .min(1)
  .describe("Column header text, or its A1 letter such as C.");

export const rangeSchema = z
  .string()
  .optional()
  .describe("A1 range such as B2:D40. Defaults to the used range.");
