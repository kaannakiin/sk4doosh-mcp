import { createRequire } from "node:module";
import { platform, arch } from "node:process";

const require = createRequire(import.meta.url);
let binding;

function fail(message) {
  return Object.assign(new Error(message), { code: "unsupported_platform" });
}

function load() {
  if (binding !== undefined) return binding;
  const target = `${platform}-${arch}`;
  if (
    ![
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-x64",
    ].includes(target)
  ) {
    throw fail("Secure filesystem access is unavailable on this platform.");
  }
  if (
    platform === "linux" &&
    !process.report.getReport().header.glibcVersionRuntime
  ) {
    throw fail(
      "Secure filesystem access requires a supported glibc Linux target.",
    );
  }
  try {
    binding = require(`./prebuilds/${target}/secure.node`);
  } catch {
    throw fail(
      "The secure filesystem binary is missing or incompatible. Install a complete platform package.",
    );
  }
  return binding;
}

function pathArgument(path) {
  if (typeof path !== "string" || path.includes("\0") || path.length > 32768) {
    throw new TypeError("Expected a bounded path without NUL bytes.");
  }
}

function budget(value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new TypeError("Invalid secure filesystem budget.");
  }
}

function object(value) {
  return typeof value === "object" && value !== null;
}
function invalidResult() {
  throw Object.assign(new Error("Invalid secure filesystem result."), {
    code: "internal_error",
  });
}

export function openRoot(path) {
  pathArgument(path);
  const api = load();
  const root = api.openRoot(path);
  return Object.freeze({
    async resolve(relative) {
      pathArgument(relative);
      const result = await api.run(root, "resolve", relative, 0, 0, 0);
      if (typeof result !== "string" || result.includes("\0")) invalidResult();
      return result;
    },
    async read(relative, maxBytes) {
      pathArgument(relative);
      budget(maxBytes, 50 * 1024 * 1024);
      const result = await api.run(root, "read", relative, maxBytes, 0, 0);
      if (
        !object(result) ||
        !Buffer.isBuffer(result.bytes) ||
        result.bytes.length > maxBytes ||
        result.size !== result.bytes.length ||
        !Number.isFinite(result.modifiedMs)
      )
        invalidResult();
      return result;
    },
    async scan(relative, maxEntries, maxDepth, maxMs) {
      pathArgument(relative);
      budget(maxEntries, 5000);
      budget(maxDepth, 64);
      budget(maxMs, 1000);
      const result = await api.run(
        root,
        "scan",
        relative,
        maxEntries,
        maxDepth,
        maxMs,
      );
      if (
        !object(result) ||
        !Array.isArray(result.entries) ||
        result.entries.length > maxEntries ||
        !Number.isSafeInteger(result.visited) ||
        result.visited < 0 ||
        result.visited > maxEntries ||
        !Number.isSafeInteger(result.unreadable) ||
        result.unreadable < 0 ||
        ![null, "entries", "depth", "time"].includes(result.reason) ||
        !result.entries.every(
          (entry) =>
            object(entry) &&
            typeof entry.path === "string" &&
            Number.isSafeInteger(entry.size) &&
            entry.size >= 0 &&
            Number.isFinite(entry.modifiedMs) &&
            typeof entry.directory === "boolean",
        )
      )
        invalidResult();
      return result;
    },
  });
}
