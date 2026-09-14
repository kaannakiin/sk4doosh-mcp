import { exit } from "node:process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = "src/i18n/locales";
const SOURCE_DIR = "src";

/**
 * Guard: a missing key is invisible at runtime — i18next renders the key itself,
 * so "auth.fields.phone.hint" ships to the reader as that literal string. Nothing
 * in the type system or the linter sees it, which is why this runs with lint.
 */
function flatten(value, prefix = "") {
  const keys = new Set();
  for (const [key, child] of Object.entries(value)) {
    if (child !== null && typeof child === "object") {
      for (const nested of flatten(child, `${prefix}${key}.`)) {
        keys.add(nested);
      }
    } else {
      keys.add(`${prefix}${key}`);
    }
  }

  return keys;
}

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.tsx?$/u.test(entry)) {
      files.push(path);
    }
  }

  return files;
}

const locales = readdirSync(LOCALES_DIR);
const byLocale = new Map(
  locales.map((locale) => [
    locale,
    flatten(
      JSON.parse(readFileSync(join(LOCALES_DIR, locale, "common.json"), "utf8")),
    ),
  ]),
);

const problems = [];

const [reference, ...others] = locales;
for (const locale of others) {
  for (const key of byLocale.get(reference)) {
    if (!byLocale.get(locale).has(key)) {
      problems.push(`${locale}/common.json is missing "${key}"`);
    }
  }
  for (const key of byLocale.get(locale)) {
    if (!byLocale.get(reference).has(key)) {
      problems.push(`${reference}/common.json is missing "${key}"`);
    }
  }
}

/**
 * Guard: a `_other` sibling makes the base key reachable through a `count`, so
 * the plural form is not a key the source has to name.
 */
const known = new Set(byLocale.get(reference));
for (const key of byLocale.get(reference)) {
  if (key.endsWith("_other")) {
    known.add(key.slice(0, -"_other".length));
  }
}

/**
 * Guard: only literal keys are checked. A handful of call sites build the key
 * from a value (`t(\`auth.errors.${code}.body\`)`), and those carry an explicit
 * `defaultValue` for the same reason.
 */
const LITERAL_KEY = /\bt\(\s*"([a-zA-Z][\w.]*)"/gu;
const TRANS_KEY = /i18nKey="([\w.]+)"/gu;

for (const file of sourceFiles(SOURCE_DIR)) {
  const text = readFileSync(file, "utf8");
  for (const pattern of [LITERAL_KEY, TRANS_KEY]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (!known.has(match[1])) {
        const line = text.slice(0, match.index).split("\n").length;
        problems.push(`${file}:${line} uses unknown key "${match[1]}"`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  exit(1);
}

console.log(`i18n ok: ${known.size} keys across ${locales.join(", ")}`);
