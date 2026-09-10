import type { Locale } from "@chat/contracts/common/locale";
import type { Request } from "express";

export interface RequestWithLocale extends Request {
  locale?: Locale;
}
