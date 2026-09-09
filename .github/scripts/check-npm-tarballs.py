import json
import sys
import tarfile
from pathlib import Path

RUNTIME_FIELDS = ("dependencies", "peerDependencies", "optionalDependencies")
REQUIRED_ENTRY = "package/dist/index.js"
EXACT_PINS = {"@sk-mcp/xml-mcp": {"libxml2-wasm": "0.7.2"}}


def fail(message):
    print(f"::error::{message}")
    return 1


def check(path):
    problems = 0
    with tarfile.open(path, "r:gz") as archive:
        names = archive.getnames()
        member = archive.extractfile("package/package.json")
        if member is None:
            return fail(f"{path.name} carries no package.json")
        manifest = json.load(member)

    for field in RUNTIME_FIELDS:
        for name, range_ in (manifest.get(field) or {}).items():
            if range_.startswith("workspace:"):
                problems += fail(
                    f"{path.name}: {field}.{name} still uses the workspace protocol ({range_})"
                )
            if name.startswith("@sk-mcp/") and range_.strip("^~") == "0.0.0":
                problems += fail(
                    f"{path.name}: {field}.{name} resolves to 0.0.0, which is not publishable"
                )

    required = "package/index.js" if manifest.get("name") == "@sk-mcp/file-core-native" else REQUIRED_ENTRY
    if required not in names:
        problems += fail(f"{path.name} carries no {required}")
    if manifest.get("name") == "@sk-mcp/file-core-native":
        import os
        targets = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]
        binaries = [name for name in names if name.endswith("/secure.node")]
        if not binaries:
            problems += fail(f"{path.name} has no secure filesystem binary")
        if os.environ.get("SKMCP_REQUIRE_ALL_PREBUILDS") == "1":
            for target in targets:
                if f"package/prebuilds/{target}/secure.node" not in names:
                    problems += fail(f"{path.name} is missing {target}")
    if manifest.get("name") == "@sk-mcp/excel-mcp" and "package/dist/regex-worker.js" not in names:
        problems += fail(f"{path.name} is missing the regex worker")
    if manifest.get("name") == "@sk-mcp/xml-mcp" and "package/dist/xml-worker.js" not in names:
        problems += fail(f"{path.name} is missing the XML parse worker")

    for name, expected in (EXACT_PINS.get(manifest.get("name")) or {}).items():
        actual = (manifest.get("dependencies") or {}).get(name)
        if actual != expected:
            problems += fail(
                f"{path.name}: dependencies.{name} must be pinned to exactly {expected}, found {actual}"
            )

    maps = [name for name in names if name.endswith(".d.ts.map")]
    if maps:
        problems += fail(f"{path.name} carries {len(maps)} .d.ts.map file(s)")

    if problems == 0:
        deps = manifest.get("dependencies") or {}
        rendered = ", ".join(f"{k}@{v}" for k, v in sorted(deps.items())) or "none"
        print(f"{path.name}: ok ({len(names)} entries; dependencies: {rendered})")
    return problems


def main(directory):
    tarballs = sorted(Path(directory).glob("*.tgz"))
    if not tarballs:
        return fail(f"no tarballs found under {directory}")
    return sum(check(path) for path in tarballs)


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1]) else 0)
