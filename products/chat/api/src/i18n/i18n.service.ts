import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from "@chat/contracts";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import i18next, { type i18n } from "i18next";

import enCommon from "./locales/en/common.json" with { type: "json" };
import enValidation from "./locales/en/validation.json" with { type: "json" };
import trCommon from "./locales/tr/common.json" with { type: "json" };
import trValidation from "./locales/tr/validation.json" with { type: "json" };
import { currentLocale } from "./locale.store.ts";

@Injectable()
export class I18nService implements OnModuleInit {
  private readonly instance: i18n = i18next.createInstance();

  async onModuleInit(): Promise<void> {
    await this.instance.init({
      resources: {
        en: { common: enCommon, validation: enValidation },
        tr: { common: trCommon, validation: trValidation },
      },
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      defaultNS: "common",
      ns: ["common", "validation"],
      interpolation: { escapeValue: false },
    });
  }

  t(
    key: string,
    vars: Record<string, unknown> = {},
    locale: Locale = currentLocale() ?? DEFAULT_LOCALE,
  ): string {
    return this.instance.getFixedT(locale)(key, vars);
  }
}
