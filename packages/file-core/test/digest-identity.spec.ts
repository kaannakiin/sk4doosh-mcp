import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openRoot } from "@sk-mcp/file-core-native";
import { contentFingerprint, fingerprintFromDigest } from "../src/cursor.js";

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "file-core-digest-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the content stamp", () => {
  it("is the salted hash of the file digest, however the digest was produced", () => {
    const bytes = Buffer.from("a document", "utf8");
    const digest = createHash("sha256").update(bytes).digest();
    expect(contentFingerprint("/root/a.probe", bytes, "v1")).toBe(
      fingerprintFromDigest("/root/a.probe", digest, "v1"),
    );
  });

  it("separates path and variant from content", () => {
    const bytes = Buffer.from("same", "utf8");
    expect(contentFingerprint("/a", bytes)).not.toBe(
      contentFingerprint("/b", bytes),
    );
    expect(contentFingerprint("/a", bytes, "x")).not.toBe(
      contentFingerprint("/a", bytes, "y"),
    );
  });

  it("catches a content change under a restored mtime and an equal size", async () => {
    const path = join(directory, "swap.probe");
    await writeFile(path, "aaaa", "utf8");
    const before = await stat(path);
    const first = contentFingerprint(path, Buffer.from("aaaa", "utf8"));

    await writeFile(path, "bbbb", "utf8");
    await utimes(path, before.atime, before.mtime);
    const after = await stat(path);

    expect(after.size).toBe(before.size);
    expect(Math.round(after.mtimeMs)).toBe(Math.round(before.mtimeMs));
    expect(contentFingerprint(path, Buffer.from("bbbb", "utf8"))).not.toBe(
      first,
    );
  });
});

describe("the native digest op", () => {
  it("equals the whole-file SHA-256", async () => {
    const path = join(directory, "hash.probe");
    const bytes = Buffer.from("z".repeat(5000), "utf8");
    await writeFile(path, bytes);
    const root = openRoot(directory);
    const outcome = await root.digest("hash.probe", 1024 * 1024);
    expect(outcome.digest.toString("hex")).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(outcome.size).toBe(bytes.length);
  });

  it("feeds a stamp identical to the byte-fed one", async () => {
    const path = join(directory, "stamp.probe");
    const bytes = Buffer.from("payload", "utf8");
    await writeFile(path, bytes);
    const root = openRoot(directory);
    const outcome = await root.digest("stamp.probe", 1024 * 1024);
    expect(fingerprintFromDigest(path, outcome.digest, "")).toBe(
      contentFingerprint(path, bytes, ""),
    );
  });
});

describe("the native range op", () => {
  it("returns the same bytes as slicing the whole read", async () => {
    const path = join(directory, "range.probe");
    const bytes = Buffer.from("0123456789abcdef", "utf8");
    await writeFile(path, bytes);
    const root = openRoot(directory);
    for (const [offset, length] of [
      [0, 4],
      [4, 6],
      [10, 6],
      [12, 99],
      [16, 4],
    ]) {
      const range = await root.readRange(
        "range.probe",
        offset as number,
        length as number,
        1024,
      );
      expect(range.bytes.toString("utf8")).toBe(
        bytes
          .subarray(offset, (offset as number) + (length as number))
          .toString("utf8"),
      );
      expect(range.size).toBe(bytes.length);
    }
  });

  it("reports file_changed the way a whole read does", async () => {
    const path = join(directory, "gone.probe");
    await writeFile(path, "x", "utf8");
    const root = openRoot(directory);
    await rm(path);
    const whole = await root.read("gone.probe", 1024).catch((e: unknown) => e);
    const ranged = await root
      .readRange("gone.probe", 0, 1, 1024)
      .catch((e: unknown) => e);
    expect((ranged as { code?: string }).code).toBe(
      (whole as { code?: string }).code,
    );
  });
});
