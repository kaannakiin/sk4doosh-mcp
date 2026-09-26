# @liaiso/xml-mcp

A read-only, sandboxed MCP server that reads local XML documents.
It builds on [@liaiso/file-core](../../cores/file-core); it does **not** depend on
`@liaiso/core` and imports nothing from `packages/lab/xml-lab`.

## Quick start

```json
{
  "mcpServers": {
    "xml": {
      "command": "npx",
      "args": ["-y", "@liaiso/xml-mcp", "/path/to/xml/root"]
    }
  }
}
```

To run it from inside the repo:

```bash
pnpm turbo run build --filter=@liaiso/xml-mcp
node packages/servers/xml-mcp/dist/cli.js /path/to/xml/root
```

The root is a required positional argument; there is no environment variable
for it. Readable extensions: `.xml`, `.xsd`, `.xhtml`, `.svg`, `.csproj`,
`.props`, `.targets`, `.config`, `.resx`. An extension like `.config` is not a
guarantee of XML — a parse error there is expected behavior.

## Tools

| Tool                 | What it does                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_documents`     | Lists readable XML documents under the root. Never parses a file, so a listed path is a candidate, not a guarantee of well-formed XML                                      |
| `describe_document`  | Summarizes one document: document element, every namespace with a stable alias, a bounded structure count, repeated-element candidates, and an address `read_node` accepts |
| `read_node`          | Reads a bounded, ordered slice of a document as flat depth-first records, in document order                                                                                |
| `find_in_document`   | Finds literal text in a document's text nodes and attribute values. Never treated as a regular expression or a query language                                              |
| `select_xpath`       | Evaluates one XPath 1.0 expression against a document, exactly as written: no rewriting, no namespace guessing, no extension functions, nothing from XPath 2.0 or later    |
| `project_records`    | Turns a repeated element into rows and named columns                                                                                                                       |
| `aggregate_document` | Counts and summarizes a repeated element in one call instead of paging its records                                                                                         |

`list_documents` never parses a file; the listed path is a candidate, not a
guarantee of well-formed XML.

`read_node` returns records in depth-first order. Every record carries
`nodeId`, `parentId` and `childIndex`, so the order of text/element/comment/PI
nodes survives a page boundary and pages merge back together without
duplication or gaps. `nodeId` is the childIndex path from the root
(`"1.3.2"`) and is unique across the document.

Values are returned as written: a leading zero, decimal notation and large
integers are preserved unchanged, whitespace is not trimmed, and CDATA text
carries a `kind` distinct from ordinary text.

`select_xpath`'s `resultType` distinguishes a node-set from a string, number
or boolean, so an empty node-set, an empty string, `false` and `0` all survive
as themselves; a number carries `numberKind` so `NaN` and infinity are never a
silent null. A node-set member is addressed where an address exists; a prolog
comment and a namespace node carry `unaddressable` instead. Evaluation can
materialize the whole node-set, so `maxResults` bounds the response, not the
cost.

`project_records`'s cell reports one of four states: present, empty (the
value exists and is the empty string), missing (the address matches nothing),
or multiple (several nodes match and no policy chose one). Rows carry an
occurrence index rather than a repeated address; a row's canonical address is
`itemParentAddress` plus `itemName` at that occurrence.

`aggregate_document`'s `count` needs no column and is always available.
`sum`, `avg`, `min` and `max` require `numericMode: binary64`, an explicit
acceptance that values become binary64 doubles: a value with more digits than
that holds is refused rather than silently changed, and values that cannot be
represented exactly are counted in `rounded`. `groupCount` and `matchedItems`
cover the whole scan even when `maxGroups` cuts the returned groups.

## Configuration

`createXmlMcpServer(root, options)` takes two optional settings; the CLI
always uses the defaults.

| Option                  | Default | Meaning                                          |
| ----------------------- | ------- | ------------------------------------------------ |
| `documentCacheSize`     | `4`     | Documents kept resident in memory at once (1–64) |
| `maxConcurrentListings` | `4`     | Concurrent `list_documents` calls                |

```ts
createXmlMcpServer(root, {
  documentCacheSize: 4,
  maxConcurrentListings: 4,
});
```

`documentCacheSize` (S) is the single knob; the worker pool's capacity is
derived as `W = 2S`, and the invariant `W >= 2S-1` is pinned by a test — the
worker keeps a document alive while the store still holds it, so its map must
fit every store entry plus the one being adopted. **This is a budget, not
enforcement**: `worker.resourceLimits` bounds the JS heap, not WASM linear
memory, so exceeding the budget is a process crash rather than a clean
`resource_limit` error. Measured cost is 9.25-10.08x the source byte count,
so roughly 81 MiB resident per document at the 8 MiB ceiling; the default
`S=4` is safe on the smallest supported host.

## Limits

| Limit                                                                                                | Value                                         |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| File size loaded into the DOM (resident)                                                             | 8 MiB                                         |
| Parse time per job                                                                                   | 2 seconds                                     |
| Concurrently active workers                                                                          | 1                                             |
| Worker queue depth                                                                                   | 5                                             |
| Response envelope                                                                                    | 512 KiB                                       |
| Page size (`read_node`, `find_in_document`, `select_xpath`, `project_records`, `aggregate_document`) | default 50, max 200 nodes/matches/rows/groups |
| DOM depth                                                                                            | 128                                           |

A document over the resident ceiling falls back to a reduced-capability
`chunked` mode: `select_xpath`, `find_in_document` and `aggregate_document`
are unavailable there (`literalSearch`, `xpath` and `aggregation` are `false`
in that mode's capability report), while `project_records` still works.

Comments and processing instructions in the prolog cannot be addressed in
this version; the ordered view is rooted at the document element.

## Rules

**Parsing happens in the worker.** The main process only ever holds a
serializable handle; a WASM pointer never crosses the boundary. No disposal
hook was needed on `@liaiso/file-core`'s document store because of this.

**Layout follows the worker/host boundary.** `engine/` is the worker-side
graph and never names `host/` or `tools/`; `model/` and `primitives/` are the
shared vocabulary between the two sides. `index.ts`, `cli.ts`,
`xml-worker.ts` and `server.ts` stay at the root — the tarball entry point,
`bin`, the CI tarball check and the `../package.json` read respectively tie
them there.

**The worker entry never imports the host surface.** `src/xml-worker.ts`
only sees `node:worker_threads`, `node:buffer`, `libxml2-wasm` and a
type-only protocol; a lint rule enforces this. A worker returns a code
string, and the host side constructs the error object.

**DOCTYPE is refused before parsing.** The prolog scanner runs in the main
process; `doc.dtd` is only the second check. Measured: `XML_PARSE_NO_XXE`
does not block the internal DTD subset.

**The worker's stdout never mixes into the parent's fd 1.** It is isolated
with `stdout: true`; on stdio MCP, a single stray line breaks JSON-RPC.

**`diag` is off in production** and cannot be turned on through an
environment variable: it costs 24.9% and its raw report carries an engine
pointer.

**Unsupported encodings are refused before parsing.** The prolog scanner
applies the XML 1.0 Appendix F four-byte autodetection; the UCS-4 and EBCDIC
families get `unsupported_encoding`. Measured: the previous scanner missed
DOCTYPE in these families.

**`libxml2-wasm` is pinned to exact `0.7.2`.** A caret would silently
invalidate the F0-01 integrity record; the CI tarball checker enforces this.

## Development

```bash
pnpm turbo run build --filter=@liaiso/xml-mcp
pnpm turbo run test --filter=@liaiso/xml-mcp
pnpm turbo run check-types --filter=@liaiso/xml-mcp
```

Run tests through Turbo, not `pnpm --filter @liaiso/xml-mcp test`: the bare
filter skips `dependsOn: ["^build"]`.

Large-document tests are opt-in and skipped by default; set
`LIAISO_XML_LARGE=1` to run them.
