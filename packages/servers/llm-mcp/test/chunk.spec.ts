import { describe, expect, it } from "vitest";
import { chunkText } from "../src/tools/chunk.js";

const squash = (text: string): string => text.replace(/\s+/gu, "");

describe("chunkText", () => {
  const paragraphs = Array.from(
    { length: 30 },
    (_, index) => `Paragraf ${String(index)}: ${"kelime ".repeat(20)}`,
  ).join("\n\n");

  it("keeps every chunk within the limit", () => {
    for (const chunk of chunkText(paragraphs, 400)) {
      expect(chunk.length).toBeLessThanOrEqual(400);
    }
  });

  it("drops nothing but whitespace", () => {
    expect(squash(chunkText(paragraphs, 400).join(""))).toBe(
      squash(paragraphs),
    );
  });

  it("cuts at paragraph breaks when paragraphs fit", () => {
    for (const chunk of chunkText(paragraphs, 400)) {
      expect(chunk.startsWith("Paragraf ")).toBe(true);
    }
  });

  it("falls back to lines, then to fixed cuts inside one long line", () => {
    const line = "ş".repeat(1_000);
    const chunks = chunkText(`kısa\n${line}`, 300);
    expect(chunks.every((chunk) => chunk.length <= 300)).toBe(true);
    expect(squash(chunks.join(""))).toBe(squash(`kısa${line}`));
  });

  it("returns nothing for blank text", () => {
    expect(chunkText(" \n\n ", 100)).toEqual([]);
  });
});
