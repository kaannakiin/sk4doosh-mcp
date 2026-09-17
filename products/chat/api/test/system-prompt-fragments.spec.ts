import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { chatToolNameSchema } from "@chat/contracts/tools/tool-name";
import { beforeAll, describe, expect, it } from "vitest";

import { I18nService } from "../src/i18n/i18n.service.ts";
import { SYSTEM_PROMPT_KEYS } from "../src/chat/system-prompt.service.ts";

const LOCALES_DIR = join(import.meta.dirname, "..", "src", "i18n", "locales");

const LOCALES = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const NAMING_FRAGMENTS = [
  "system.tools.readers",
  "system.tools.workbook",
  "system.tools.document",
  "tools.manifest",
];

const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu;

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/gu;

function flatten(value: unknown, prefix: string): Map<string, string> {
  const flat = new Map<string, string>();
  if (typeof value === "string") {
    flat.set(prefix, value);

    return flat;
  }

  if (typeof value !== "object" || value === null) {
    return flat;
  }

  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    for (const [nested, text] of flatten(entry, path)) {
      flat.set(nested, text);
    }
  }

  return flat;
}

function bundleOf(locale: string): Map<string, string> {
  const flat = new Map<string, string>();
  for (const file of readdirSync(join(LOCALES_DIR, locale))) {
    const raw = readFileSync(join(LOCALES_DIR, locale, file), "utf8");
    const namespace = file.replace(/\.json$/u, "");
    for (const [key, text] of flatten(JSON.parse(raw), "")) {
      flat.set(`${namespace}:${key}`, text);
    }
  }

  return flat;
}

function tokens(value: string, pattern: RegExp): Set<string> {
  return new Set(value.match(new RegExp(pattern, pattern.flags)) ?? []);
}

const BUNDLES = new Map(LOCALES.map((locale) => [locale, bundleOf(locale)]));

/**
 * `web/scripts/check-i18n.mjs` reads the web package and only `common.json`, so
 * nothing today sees these files. A key present in one locale and missing in
 * another renders as its own name — inside the system prompt, which no user
 * ever sees, so the failure is silent for as long as nobody reads Turkish
 * output closely.
 */
describe("api locale bundles", () => {
  it("covers more than one locale", () => {
    expect(LOCALES.length).toBeGreaterThan(1);
  });

  for (const locale of LOCALES) {
    const bundle = BUNDLES.get(locale) ?? new Map<string, string>();

    it(`holds the same keys as every other locale, from ${locale}`, () => {
      for (const [other, compared] of BUNDLES) {
        if (other === locale) {
          continue;
        }

        for (const key of bundle.keys()) {
          expect(compared.has(key), `${key} is missing from ${other}`).toBe(
            true,
          );
        }
      }
    });

    it(`carries no empty value in ${locale}`, () => {
      for (const [key, text] of bundle) {
        expect(text.trim(), `${key} is blank`).not.toBe("");
      }
    });

    it(`keeps every interpolation of ${locale} in step`, () => {
      for (const [other, compared] of BUNDLES) {
        if (other === locale) {
          continue;
        }

        for (const [key, text] of bundle) {
          const twin = compared.get(key);
          if (twin === undefined) {
            continue;
          }

          expect(
            [...tokens(text, PLACEHOLDER)].sort(),
            `${key} in ${other}`,
          ).toEqual([...tokens(twin, PLACEHOLDER)].sort());
        }
      }
    });
  }
});

/**
 * Guard: the always-on block is the one message that cannot know which tools the
 * turn holds, so naming one there is how the prompt came to order a small model
 * to call `describe_workbook` in conversations that had no reader at all.
 */
describe("system.core", () => {
  for (const locale of LOCALES) {
    it(`names no tool in ${locale}`, () => {
      const text = BUNDLES.get(locale)?.get("chat:system.core") ?? "";

      expect(text).not.toBe("");
      expect([...tokens(text, SNAKE_CASE)]).toEqual([]);
    });
  }
});

describe("capability fragments", () => {
  for (const locale of LOCALES) {
    it(`name only tools this product ships in ${locale}`, () => {
      const known = new Set<string>(chatToolNameSchema.options);

      for (const fragment of NAMING_FRAGMENTS) {
        const text = BUNDLES.get(locale)?.get(`chat:${fragment}`) ?? "";
        expect(text, `${fragment} is missing`).not.toBe("");

        for (const name of tokens(text, SNAKE_CASE)) {
          expect(known.has(name), `${fragment} names ${name}`).toBe(true);
        }
      }
    });
  }
});

describe("SYSTEM_PROMPT_KEYS", () => {
  const i18n = new I18nService();

  beforeAll(async () => {
    await i18n.onModuleInit();
  });

  for (const locale of LOCALES) {
    it(`resolves every key in ${locale}`, () => {
      for (const key of SYSTEM_PROMPT_KEYS) {
        const rendered = i18n.t(`chat:${key}`, {}, locale as "en");

        expect(rendered, `${key} is unresolved`).not.toBe(`chat:${key}`);
        expect(rendered.trim(), `${key} is blank`).not.toBe("");
      }
    });
  }
});
