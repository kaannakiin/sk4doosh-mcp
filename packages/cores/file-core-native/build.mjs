import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const version = process.versions.node;
const candidates = [
  process.env.SKMCP_NODE_HEADERS,
  resolve(dirname(process.execPath), "../include/node"),
  join(homedir(), "Library/Caches/node-gyp", version, "include/node"),
  join(homedir(), ".cache/node-gyp", version, "include/node"),
  join(
    process.env.LOCALAPPDATA ?? homedir(),
    "node-gyp/Cache",
    version,
    "include/node",
  ),
].filter(Boolean);
const headers = candidates.find((candidate) =>
  existsSync(join(candidate, "node_api.h")),
);
if (!headers)
  throw new Error(
    "Node-API headers missing. Set SKMCP_NODE_HEADERS to an installed Node include directory.",
  );
const outputDir = join(
  root,
  "prebuilds",
  `${process.platform}-${process.arch}`,
);
mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, "secure.node");
const source = join(root, "src/secure.cc");
let compiler;
let args;
if (process.platform === "win32") {
  compiler = "cl.exe";
  const library = process.env.SKMCP_NODE_LIB;
  if (!library || !existsSync(library))
    throw new Error("Set SKMCP_NODE_LIB to the matching x64 node.lib.");
  args = [
    "/nologo",
    "/LD",
    "/EHsc",
    "/std:c++17",
    "/DNAPI_VERSION=8",
    `/I${headers}`,
    source,
    `/Fo${join(outputDir, "secure.obj")}`,
    "/link",
    library,
    `/OUT:${output}`,
  ];
} else {
  compiler = process.env.CXX ?? "c++";
  args = [
    "-std=c++17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fPIC",
    "-shared",
    "-DNAPI_VERSION=8",
    `-I${headers}`,
    source,
    "-o",
    output,
  ];
  if (process.platform === "darwin") args.push("-undefined", "dynamic_lookup");
}
const result = spawnSync(compiler, args, { stdio: "inherit", cwd: root });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
