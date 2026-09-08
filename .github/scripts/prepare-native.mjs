import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = join(
  process.env.RUNNER_TEMP ?? tmpdir(),
  `skmcp-node-${process.versions.node}`,
);
await mkdir(folder, { recursive: true });
const base = `https://nodejs.org/dist/v${process.versions.node}`;
const checksumsResponse = await fetch(`${base}/SHASUMS256.txt`);
if (!checksumsResponse.ok)
  throw new Error("Could not fetch official Node checksums");
const checksums = await checksumsResponse.text();
async function download(name, target) {
  const expected = checksums
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(`  ${name}`))
    ?.split(/\s+/)[0];
  if (!expected) throw new Error(`Missing checksum for ${name}`);
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`Cannot fetch ${name}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== expected)
    throw new Error(`Checksum mismatch for ${name}`);
  await writeFile(target, data);
}
const archive = join(folder, "headers.tar.gz");
await download(`node-v${process.versions.node}-headers.tar.gz`, archive);
const unpack = spawnSync("tar", ["-xzf", archive, "-C", folder], {
  stdio: "inherit",
});
if (unpack.status !== 0) throw new Error("Node headers extraction failed");
const variables = {
  SKMCP_NODE_HEADERS: join(
    folder,
    `node-v${process.versions.node}`,
    "include",
    "node",
  ),
};
if (process.platform === "win32") {
  const library = join(folder, "node.lib");
  await download("win-x64/node.lib", library);
  variables.SKMCP_NODE_LIB = library;
  const vswhere = join(
    process.env["ProgramFiles(x86)"],
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  const vs = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8" },
  );
  if (vs.status !== 0 || !vs.stdout.trim())
    throw new Error("MSVC installation not found");
  const command = `call "${join(vs.stdout.trim(), "Common7", "Tools", "VsDevCmd.bat")}" -arch=x64 >nul && set`;
  const environment = spawnSync("cmd.exe", ["/d", "/s", "/c", command], {
    encoding: "utf8",
  });
  if (environment.status !== 0)
    throw new Error("MSVC environment setup failed");
  for (const line of environment.stdout.split(/\r?\n/)) {
    const equals = line.indexOf("=");
    const key = line.slice(0, equals);
    if (/^(PATH|INCLUDE|LIB|LIBPATH)$/i.test(key))
      variables[key] = line.slice(equals + 1);
  }
}
if (!process.env.GITHUB_ENV) throw new Error("This helper requires GITHUB_ENV");
await appendFile(
  process.env.GITHUB_ENV,
  Object.entries(variables)
    .map(([key, value]) => `${key}=${value}\n`)
    .join(""),
);
console.log(
  `Prepared verified Node ${process.versions.node} headers for ${process.platform}-${process.arch}`,
);
