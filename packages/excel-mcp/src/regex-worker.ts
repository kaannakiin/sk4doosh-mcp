/**
 * Guard: this entry stays at the src/ root so tsc emits dist/regex-worker.js.
 * check-npm-tarballs.py fails the pack job when package/dist/regex-worker.js is
 * missing, and rootDir "src" mirrors the source tree — a folder here moves the
 * emitted path, the pack job goes red, and the published server's regex search
 * cannot start.
 */
import { parentPort, workerData } from "node:worker_threads";

const port = parentPort;
if (port === null) throw new Error("Regex worker requires a parent port.");
const options: unknown = workerData;
if (
  typeof options !== "object" ||
  options === null ||
  !("query" in options) ||
  typeof options.query !== "string" ||
  options.query.length > 256 ||
  !("caseSensitive" in options) ||
  typeof options.caseSensitive !== "boolean"
) {
  port.postMessage({ error: "invalid_pattern" });
} else {
  try {
    const expression = new RegExp(
      options.query,
      options.caseSensitive ? "" : "i",
    );
    port.postMessage({ ready: true });
    port.on("message", (message: unknown) => {
      if (
        !Array.isArray(message) ||
        Buffer.byteLength(JSON.stringify(message)) > 65536 ||
        !message.every((value: unknown) => typeof value === "string")
      ) {
        port.postMessage({ error: "resource_limit" });
        return;
      }
      port.postMessage(
        message.map(
          (text: string) =>
            text !== "" && expression.test(text.normalize("NFC")),
        ),
      );
    });
  } catch {
    port.postMessage({ error: "invalid_pattern" });
  }
}
