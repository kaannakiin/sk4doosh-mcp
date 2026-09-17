import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CHAT_TOOL_POLICY } from "@chat/contracts/tools/approval-policy";
import { chatToolNameSchema } from "@chat/contracts/tools/tool-name";
import { describe, expect, it } from "vitest";

import { chatToolDigest } from "../src/connections/tool-digest.ts";

const LOCALES = ["en", "tr"] as const;

function reasonsOf(locale: string): Record<string, string> {
  const raw = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "src",
      "i18n",
      "locales",
      locale,
      "chat.json",
    ),
    "utf8",
  );

  return (JSON.parse(raw) as { approval: { reasons: Record<string, string> } })
    .approval.reasons;
}

/**
 * `check-i18n.mjs` cannot see these keys: the gate builds them from the tool
 * name, and that script only matches literals. Without this test a tool whose
 * posture changed to `askable` renders its raw key as the prompt's reason, which
 * is what `find_tools` did for as long as it was in the vocabulary.
 */
describe("approval reasons", () => {
  for (const locale of LOCALES) {
    it(`covers every askable tool in ${locale}`, () => {
      const reasons = reasonsOf(locale);

      for (const name of chatToolNameSchema.options) {
        if (CHAT_TOOL_POLICY[name] === "auto") {
          expect(reasons[name], `${name} never asks`).toBeUndefined();
          continue;
        }

        expect(reasons[name], `${name} is asked about`).toBeTypeOf("string");
      }
    });

    it(`names no tool it does not ship in ${locale}`, () => {
      const known = new Set<string>(chatToolNameSchema.options);

      for (const name of Object.keys(reasonsOf(locale))) {
        expect(known.has(name), `${name} is not a tool`).toBe(true);
      }
    });
  }
});

describe("chatToolDigest", () => {
  it("is stable and distinct per tool", () => {
    const seen = new Map<string, string>();

    for (const name of chatToolNameSchema.options) {
      const digest = chatToolDigest(name).toString("hex");

      expect(digest).toHaveLength(64);
      expect(chatToolDigest(name).toString("hex")).toBe(digest);
      expect(seen.has(digest), `${name} collides`).toBe(false);
      seen.set(digest, name);
    }
  });
});
