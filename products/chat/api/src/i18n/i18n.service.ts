import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from "@chat/contracts/common/locale";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import i18next, { type i18n } from "i18next";

import type { AppConfig } from "../config/configuration.ts";
import enChat from "./locales/en/chat.json" with { type: "json" };
import enCommon from "./locales/en/common.json" with { type: "json" };
import enHttp from "./locales/en/http.json" with { type: "json" };
import enValidation from "./locales/en/validation.json" with { type: "json" };
import trChat from "./locales/tr/chat.json" with { type: "json" };
import trCommon from "./locales/tr/common.json" with { type: "json" };
import trHttp from "./locales/tr/http.json" with { type: "json" };
import trValidation from "./locales/tr/validation.json" with { type: "json" };
import { currentLocale } from "./locale.store.ts";

const NAMESPACES = ["common", "validation", "chat", "http"];

@Injectable()
export class I18nService implements OnModuleInit {
  private readonly instance: i18n = i18next.createInstance();

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get defaultLocale(): Locale {
    return this.config.get("defaultLocale", { infer: true }) ?? DEFAULT_LOCALE;
  }

  async onModuleInit(): Promise<void> {
    await this.instance.init({
      resources: {
        en: {
          common: enCommon,
          validation: enValidation,
          chat: enChat,
          http: enHttp,
        },
        tr: {
          common: trCommon,
          validation: trValidation,
          chat: trChat,
          http: trHttp,
        },
      },
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      defaultNS: "common",
      ns: NAMESPACES,
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
