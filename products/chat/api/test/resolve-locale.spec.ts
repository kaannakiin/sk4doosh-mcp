import { negotiateLocale } from "@chat/contracts/common/negotiate-locale";
import { describe, expect, it } from "vitest";

import { resolveLocale } from "../src/i18n/resolve-locale.ts";

describe("resolveLocale", () => {
  it("prefers the query parameter over every other signal", () => {
    expect(
      resolveLocale(
        { query: "tr", header: "en", acceptLanguage: "en-US" },
        "en",
      ),
    ).toBe("tr");
  });

  it("falls back to the header when the query is absent", () => {
    expect(resolveLocale({ header: "tr", acceptLanguage: "en-US" }, "en")).toBe(
      "tr",
    );
  });

  it("ignores an unsupported explicit value and negotiates instead", () => {
    expect(resolveLocale({ query: "de", acceptLanguage: "tr-TR" }, "en")).toBe(
      "tr",
    );
  });

  it("returns the fallback when nothing matches", () => {
    expect(resolveLocale({ acceptLanguage: "de-DE,fr;q=0.9" }, "en")).toBe(
      "en",
    );
  });
});

describe("negotiateLocale", () => {
  it("honours the quality order rather than the written order", () => {
    expect(negotiateLocale("en;q=0.3,tr;q=0.9", "en")).toBe("tr");
  });

  it("matches on the primary subtag", () => {
    expect(negotiateLocale("tr-TR,tr;q=0.9,en;q=0.8", "en")).toBe("tr");
  });

  it("skips the highest ranked tag when it is unsupported", () => {
    expect(negotiateLocale("de-DE,tr;q=0.9,en;q=0.8", "en")).toBe("tr");
  });

  it("drops a tag explicitly refused with q=0", () => {
    expect(negotiateLocale("tr;q=0,en;q=0.5", "tr")).toBe("en");
  });

  it("treats a wildcard as no preference", () => {
    expect(negotiateLocale("*", "tr")).toBe("tr");
  });

  it("returns the fallback for a missing or empty header", () => {
    expect(negotiateLocale(undefined, "tr")).toBe("tr");
    expect(negotiateLocale("", "en")).toBe("en");
  });

  it("tolerates whitespace and casing", () => {
    expect(negotiateLocale("  TR-tr ; q=0.8 , en ; q=0.2 ", "en")).toBe("tr");
  });
});
