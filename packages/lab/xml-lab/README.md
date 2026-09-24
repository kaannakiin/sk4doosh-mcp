# @sk-mcp/xml-lab

The F0 evidence harness for the XML MCP engine gate.

## What this is

This package is **not product code**. It holds the experiments that measured the
`libxml2-wasm` choice on the target distribution, the fixture generators, and the evidence
collector. Its output goes to `packages/lab/xml-lab/out/f0/*.json`, which is git-ignored.

## Why it stays in the repo

The exit gate reads: "a failed engine choice is re-tested against the same fixture matrix." If
the engine were ever rejected, `@xmldom/xmldom` + `xpath` would have to pass the same corpus. The
fixture generator, the manifest and the assertions are therefore kept largely independent of the
engine; engine-specific calls are collected in the probe files.

## What this will never be

- No `build` script, so no `dist/`. The package cannot be imported.
- No `main`, `types`, `exports`, `files`, `bin` or `publishConfig`. `private: true`.
- Not listed in any package's `dependencies`, `devDependencies` or `peerDependencies`. Once
  `packages/servers/xml-mcp` exists, it imports nothing from here.
- Never added to the `pack` job's filter list.
- No product code: no MCP server, no tool handler, no `file-core` integration, no cursor codec.
- `libxml2-wasm` stays in `devDependencies` only, at an **exact** version. A caret would silently
  invalidate the F0-01 integrity evidence.
- Tests never write into the repository's working tree. A probe writes to stdout; the collector
  writes under `out/f0/`.

## Experiment structure

Each experiment has three layers: `test/*.spec.ts` (`spawnSync`, a heap cap, a timeout) →
`test/probes/*.mjs` (self-asserting, self-measuring) → **exactly one JSON line on stdout**.
Dangerous fixtures never run unbounded inside the normal test runner process.

`--max-old-space-size` only bounds the JS heap — it does not bound WASM linear memory. The only
reliable evidence of resident memory is measured RSS.

## Running

```bash
pnpm turbo run check-types lint --filter=@sk-mcp/xml-lab
pnpm turbo run test --filter=@sk-mcp/xml-lab --force
node packages/lab/xml-lab/collect-evidence.mjs
```

`collect-evidence.mjs` writes its JSON evidence files to `packages/lab/xml-lab/out/f0/`
(git-ignored).

`SKMCP_XML_BENCH=1` turns on the full measurement tier; by default only the 1 MiB tier runs.
`SKMCP_XML_F0_NO_NETWORK=1` skips F0-02 and records it as "not run" in the evidence.
