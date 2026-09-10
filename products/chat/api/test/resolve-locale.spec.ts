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

  it("negotiates Accept-Language against the supported locales", () => {
    expect(
      resolveLocale({ acceptLanguage: "de-DE,tr;q=0.9,en;q=0.8" }, "en"),
    ).toBe("tr");
  });

  it("returns the fallback for an unsupported locale", () => {
    expect(resolveLocale({ query: "de", acceptLanguage: "de-DE" }, "en")).toBe(
      "en",
    );
  });
});
