import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import process from "node:process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../src/codex/protocol/generated");
const launcher = createRequire(import.meta.url).resolve(
  "@openai/codex/bin/codex.js",
);

const ENTRIES = [
  "InitializeParams",
  "InitializeResponse",
  "v2/ThreadStartParams",
  "v2/ThreadStartResponse",
  "v2/ThreadResumeParams",
  "v2/ThreadResumeResponse",
  "v2/TurnStartParams",
  "v2/TurnStartResponse",
  "v2/TurnInterruptParams",
  "v2/TurnInterruptResponse",
  "v2/ThreadUnsubscribeParams",
  "v2/ThreadUnsubscribeResponse",
  "v2/ThreadCompactStartParams",
  "v2/ThreadCompactStartResponse",
  "v2/ModelListParams",
  "v2/ModelListResponse",
  "v2/ThreadItem",
  "v2/ThreadStartedNotification",
  "v2/TurnStartedNotification",
  "v2/TurnCompletedNotification",
  "v2/ItemStartedNotification",
  "v2/ItemCompletedNotification",
  "v2/AgentMessageDeltaNotification",
  "v2/ThreadTokenUsageUpdatedNotification",
  "v2/AccountRateLimitsUpdatedNotification",
  "v2/ErrorNotification",
  "v2/McpServerStatusUpdatedNotification",
];

const scratch = mkdtempSync(join(tmpdir(), "codex-protocol-"));
try {
  const run = spawnSync(
    process.execPath,
    [launcher, "app-server", "generate-ts", "--out", scratch],
    { stdio: "inherit" },
  );
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }

  const seen = new Set();
  const stack = ENTRIES.map((entry) => join(scratch, `${entry}.ts`));
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) {
      continue;
    }
    if (!existsSync(file)) {
      throw new Error(`missing generated type ${relative(scratch, file)}`);
    }
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(
      /from "(\.[^"]+)"/gu,
    )) {
      stack.push(resolve(dirname(file), `${match[1]}.ts`));
    }
  }

  rmSync(target, { recursive: true, force: true });
  for (const file of [...seen].sort()) {
    const out = join(target, relative(scratch, file));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      readFileSync(file, "utf8").replace(/from "(\.[^"]+)"/gu, 'from "$1.ts"'),
    );
  }
  process.stdout.write(
    `wrote ${seen.size} files to ${relative(process.cwd(), target)}\n`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
