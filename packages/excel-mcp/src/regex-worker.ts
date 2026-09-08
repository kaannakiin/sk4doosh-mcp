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
