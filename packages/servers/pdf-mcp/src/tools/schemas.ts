import { z } from "zod";
import { limits } from "../platform/limits.js";

export const filePath = z
  .string()
  .min(1)
  .describe("Path to a PDF document, relative to the server root.");

export const pages = z
  .array(z.int().min(1))
  .min(1)
  .max(limits.maxReadPages)
  .describe(
    "Page numbers to read, counted from 1. Omit to read from the first page.",
  );

export const query = z
  .string()
  .min(1)
  .max(limits.maxQueryChars)
  .describe("Literal text to look for. Never treated as a regular expression.");
