import type { Locale } from "@chat/contracts";
import type { Request } from "express";

export interface RequestWithLocale extends Request {
  locale?: Locale;
}
