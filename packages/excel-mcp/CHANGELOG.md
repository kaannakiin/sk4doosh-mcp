# Unreleased — Excel/file-core hardening

## Compatibility changes

- Secure file access now requires the bundled Node-API binary. Supported targets: glibc Linux x64/arm64 (kernel 5.6+), macOS x64/arm64, Windows x64. Unsupported or incomplete installs fail closed. No compiler is needed when installing the complete release tarball.
- Cursors are v2. Restart reads carrying a v1 cursor. Explicit conflicting interpretation options return `invalid_argument`; omitted options inherit the first page. `maxCells` may change. `sheetName` and `range` remain prohibited with a cursor. CSV auto detection versus an explicit encoding/delimiter is part of the locked parser configuration.
- `findInSheet` returns a Promise. Await it. JavaScript regex features are preserved except the existing Unicode-property-escape restriction; searches have a two-second worker deadline, two active workers, eight queued requests and 64 KiB message batches. Cancellation and shutdown await worker termination.
- `parseCsv` and `parseXlsx` now accept snapshot bytes, not FileHandle. file-core `ParseContext` exposes `bytes`, `displayPath` and content identity. Load documents through a pinned sandbox root; forging a SandboxedPath does not grant access.
- Cache hits and cursor continuation re-read and hash the file bytes. This increases I/O while avoiding repeat parsing of unchanged content. Concurrent writing is checked before/after reading; no atomic OS snapshot is promised.
- CSV UTF decoding is strict even with explicit UTF encoding. Maximum record width is 16,384 fields; existing 16 MiB and 2,000,000-cell budgets remain. Blank physical records remain in place.
- `numeric_overflow` reports non-finite inputs and arithmetic. Mixed-type min/max and incompatible between bounds return `invalid_argument`. Empty sum remains null; a real zero remains zero.
- Listing adds `totalExact`, `scanTruncated` and `scanTruncationReason`. `truncated` describes returned-result slicing only. At the visit budget, totals are conservatively inexact even if the unseen next operation would have reached EOF.
- Aggregation adds `returnedMatchedRows` and `omittedMatchedRows`. Metric counted/skipped counts apply to returned groups; `matchedRows` still covers every matching group.
- Validation counts may be null after 5,000 inspected entries; check `dataValidationRuleCountExact`. Image counts are not exhaustive; check `imageCountExact`. Metadata tools expose structured `limitations` and `complete`/`definedNamesComplete` markers.
- Raw internal exception text is logged only to stderr. MCP error messages/recovery redact absolute paths, including sibling roots and Windows paths.

## Deliberate metadata limitations

Absolute-anchor images (EXCEL-META-009), formula conditional-format thresholds (EXCEL-META-010), and sheet-local defined names (EXCEL-META-025) remain explicit, tested limitations. Their follow-up acceptance criteria live in `docs/xml/excel-hardening-uygulama.md`. Missing parser metadata is never presented as an exhaustive absence claim.
