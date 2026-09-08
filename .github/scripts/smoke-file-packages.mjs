import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const input = resolve(process.argv[2] ?? "local/npm-tarballs");
const names = await readdir(input);
const archive = (prefix) => {
  const matches = names.filter(
    (name) => name.startsWith(prefix) && name.endsWith(".tgz"),
  );
  if (matches.length !== 1)
    throw new Error(`Expected exactly one ${prefix} tarball`);
  return `file:${join(input, matches[0]).replaceAll("\\", "/")}`;
};
const directory = await mkdtemp(join(tmpdir(), "file-packages-smoke-"));
try {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "@sk-mcp/file-core-native": archive("sk-mcp-file-core-native-"),
        "@sk-mcp/file-core": archive("sk-mcp-file-core-0"),
        "@sk-mcp/excel-mcp": archive("sk-mcp-excel-mcp-"),
      },
      overrides: {
        "@sk-mcp/file-core-native": "$@sk-mcp/file-core-native",
        "@sk-mcp/file-core": "$@sk-mcp/file-core",
      },
    }),
  );
  const installed = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--cache",
      join(directory, "npm-cache"),
    ],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 180000,
      shell: process.platform === "win32",
    },
  );
  if (installed.status !== 0)
    throw new Error(`Clean package install failed: ${installed.stderr}`);
  const data = join(directory, "data");
  await mkdir(data);
  await writeFile(join(data, "smoke.csv"), "name,value\na,1\nb,2\n");
  await writeFile(
    join(directory, "smoke.mjs"),
    `
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('@sk-mcp/excel-mcp')), 'cli.js');
const transport = new StdioClientTransport({ command: process.execPath, args: [cli, ${JSON.stringify(data)}] });
const client = new Client({ name:'packed-smoke', version:'1.0.0' });
try {
  await client.connect(transport);
  const result = await client.callTool({ name:'read_sheet', arguments:{ filePath:'smoke.csv' } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text).values, [['a','1'],['b','2']]);
  const regex = await client.callTool({ name:'find_in_sheet', arguments:{ filePath:'smoke.csv', query:'^a$', matchMode:'regex' } });
  assert.notEqual(regex.isError, true); assert.equal(JSON.parse(regex.content[0].text).total,1);
} finally { await client.close(); await transport.close(); }
`,
  );
  const smoke = spawnSync(process.execPath, [join(directory, "smoke.mjs")], {
    cwd: directory,
    encoding: "utf8",
    timeout: 20000,
  });
  if (smoke.status !== 0)
    throw new Error(`Installed MCP smoke failed: ${smoke.stderr}`);
  const manifest = JSON.parse(
    await readFile(
      join(directory, "node_modules/@sk-mcp/file-core-native/package.json"),
      "utf8",
    ),
  );
  console.log(
    `Installed native ${manifest.version}, snapshot read and regex worker passed on ${process.platform}-${process.arch} (${basename(input)}).`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
