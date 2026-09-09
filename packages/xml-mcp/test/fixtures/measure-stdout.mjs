import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const root = process.argv[2];

const child = spawn(process.execPath, [cli, root], {
  stdio: ["pipe", "pipe", "pipe"],
});

let out = "";
let err = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  out += chunk;
});
child.stderr.on("data", (chunk) => {
  err += chunk;
});

const send = (message) => {
  child.stdin.write(`${JSON.stringify(message)}\n`);
};

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "stdout-probe", version: "0.0.0" },
  },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "list_documents", arguments: {} },
});

await new Promise((resolve) => setTimeout(resolve, 2500));
child.stdin.end();
child.kill();
await once(child, "exit").catch(() => undefined);

const lines = out.split("\n").filter((line) => line.trim() !== "");
const parsed = lines.map((line) => {
  try {
    const value = JSON.parse(line);
    return value.jsonrpc === "2.0";
  } catch {
    return false;
  }
});

process.stdout.write(
  `${JSON.stringify({
    lines: lines.length,
    allFramed: parsed.every((value) => value === true),
    responded: lines.length >= 3,
    stderrBytes: Buffer.byteLength(err, "utf8"),
  })}\n`,
);
