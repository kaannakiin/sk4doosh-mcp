import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rename,
  rm,
  realpath,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Worker } from "node:worker_threads";
import { openRoot } from "../index.js";

const parent = await realpath(
  await mkdtemp(
    join(process.platform === "win32" ? tmpdir() : "/tmp", "native-hardening-"),
  ),
);
const inside = join(parent, "root");
const outside = join(parent, "outside");
await mkdir(inside);
await mkdir(outside);
await writeFile(join(inside, "safe.txt"), "SAFE");
await writeFile(join(outside, "safe.txt"), "SECRET");
const root = openRoot(inside);
let socket;
let racer;
try {
  assert.equal((await root.read("safe.txt", 4)).bytes.toString(), "SAFE");
  await assert.rejects(root.read("safe.txt", 3), { code: "file_too_large" });
  await assert.rejects(root.read("../outside/safe.txt", 100), {
    code: "path_outside_root",
  });
  await assert.rejects(root.read(".", 100), { code: "not_a_file" });
  await symlink(join(inside, "safe.txt"), join(inside, "inward.txt"), "file");
  await symlink(join(outside, "safe.txt"), join(inside, "outward.txt"), "file");
  await symlink("cycle-b", join(inside, "cycle-a"), "file");
  await symlink("cycle-a", join(inside, "cycle-b"), "file");
  assert.equal((await root.read("inward.txt", 4)).bytes.toString(), "SAFE");
  await assert.rejects(root.read("outward.txt", 100), {
    code: "path_outside_root",
  });
  await assert.rejects(root.read("cycle-a", 100), {
    code: "path_outside_root",
  });

  if (process.platform === "win32") {
    await symlink(
      String.raw`\\unreachable.invalid\share\secret.txt`,
      join(inside, "unc.txt"),
      "file",
    );
    await assert.rejects(root.read("unc.txt", 100), {
      code: "path_outside_root",
    });
  }

  if (process.platform !== "win32") {
    assert.equal(spawnSync("mkfifo", [join(inside, "pipe.txt")]).status, 0);
    await assert.rejects(root.read("pipe.txt", 100), { code: "not_a_file" });
    socket = createServer();
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.listen(join(inside, "socket.txt"), resolve);
    });
    await assert.rejects(root.read("socket.txt", 100), { code: "not_a_file" });
  }

  // Race both a final link and an ancestor while readers run against the pinned root.
  await mkdir(join(inside, "real"));
  await writeFile(join(inside, "real", "safe.txt"), "SAFE");
  racer = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const fs = require('node:fs'); const path = require('node:path');
    const { inside, outside } = workerData;
    for (let i = 0; i < 400; i++) {
      for (const [name,target,kind] of [['leaf.txt', i % 2 ? path.join(inside,'safe.txt') : path.join(outside,'safe.txt'),'file'], ['ancestor',i % 2 ? path.join(inside,'real') : outside,process.platform==='win32'?'junction':'dir']]) {
        const temp=path.join(inside,name+'.next');
        try { fs.unlinkSync(temp); } catch {}
        try { fs.symlinkSync(target,temp,kind); fs.renameSync(temp,path.join(inside,name)); } catch {}
      }
    }
    parentPort.postMessage('done');
  `,
    { eval: true, workerData: { inside, outside } },
  );
  const done = new Promise((resolve, reject) => {
    racer.once("message", resolve);
    racer.once("error", reject);
  });
  let allowed = 0,
    refused = 0;
  for (let i = 0; i < 400; i += 1) {
    for (const path of ["leaf.txt", "ancestor/safe.txt"]) {
      try {
        assert.equal((await root.read(path, 100)).bytes.toString(), "SAFE");
        allowed += 1;
      } catch (error) {
        assert.ok(
          [
            "path_outside_root",
            "file_changed",
            "file_not_found",
            "not_a_file",
          ].includes(error.code),
          `${error.code} (${error.nativeError}): ${String(error)}`,
        );
        refused += 1;
      }
    }
  }
  await done;
  await racer.terminate();
  assert.equal(allowed + refused, 800);

  // A renamed root remains the same capability, rather than following a replacement path.
  const pinned = join(parent, "pinned");
  await rename(inside, pinned);
  await mkdir(inside);
  await writeFile(join(inside, "safe.txt"), "SECRET");
  assert.equal((await root.read("safe.txt", 100)).bytes.toString(), "SAFE");
  await rename(inside, join(parent, "replacement"));
  await rename(pinned, inside);
  const fdPath = process.platform === "linux" ? "/proc/self/fd" : "/dev/fd";
  if (process.platform !== "win32") {
    const before = (await readdir(fdPath)).length;
    for (let i = 0; i < 100; i += 1) {
      await root.read("safe.txt", 4);
      await assert.rejects(root.read("cycle-a", 100));
    }
    assert.ok(
      (await readdir(fdPath)).length <= before + 1,
      "file descriptor leak",
    );
  }
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      raceReads: allowed + refused,
      secretReads: 0,
      peakRssKiB: process.resourceUsage().maxRSS,
    }),
  );
} finally {
  if (racer) await racer.terminate();
  if (socket) await new Promise((resolve) => socket.close(resolve));
  await rm(parent, { recursive: true, force: true, maxRetries: 3 });
}
