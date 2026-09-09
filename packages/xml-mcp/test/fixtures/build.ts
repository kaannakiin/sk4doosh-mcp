import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Fixtures {
  readonly root: string;
  readonly simple: string;
  readonly namespaced: string;
  readonly legacyProject: string;
  readonly doctype: string;
  readonly doctypeInComment: string;
  readonly doctypeUtf16: string;
  readonly malformed: string;
  readonly nested: string;
}

const utf16le = (text: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

export async function buildFixtures(): Promise<Fixtures> {
  const root = await mkdtemp(join(tmpdir(), "xml-mcp-fixtures-"));
  await mkdir(join(root, "nested"), { recursive: true });

  const fixtures: Fixtures = {
    root,
    simple: join(root, "simple.xml"),
    namespaced: join(root, "namespaced.xml"),
    legacyProject: join(root, "legacy.csproj"),
    doctype: join(root, "doctype.xml"),
    doctypeInComment: join(root, "comment-doctype.xml"),
    doctypeUtf16: join(root, "utf16-doctype.xml"),
    malformed: join(root, "malformed.xml"),
    nested: join(root, "nested", "inner.svg"),
  };

  await writeFile(
    fixtures.simple,
    '<?xml version="1.0" encoding="UTF-8"?>\n<catalog><item id="1">first</item></catalog>\n',
    "utf8",
  );
  await writeFile(
    fixtures.namespaced,
    '<?xml version="1.0"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0"><artifactId>demo</artifactId></project>\n',
    "utf8",
  );
  await writeFile(
    fixtures.legacyProject,
    '<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003"><PropertyGroup><TargetFramework>net48</TargetFramework></PropertyGroup></Project>\n',
    "utf8",
  );
  await writeFile(
    fixtures.doctype,
    '<!DOCTYPE catalog [<!ENTITY x "expanded">]>\n<catalog>&x;</catalog>\n',
    "utf8",
  );
  await writeFile(
    fixtures.doctypeInComment,
    '<?xml version="1.0"?>\n<!-- <!DOCTYPE trap> -->\n<catalog><item><![CDATA[<!DOCTYPE also-a-trap>]]></item></catalog>\n',
    "utf8",
  );
  await writeFile(
    fixtures.doctypeUtf16,
    utf16le("<!DOCTYPE catalog>\n<catalog/>\n"),
  );
  await writeFile(fixtures.malformed, "<catalog><item></catalog>\n", "utf8");
  await writeFile(
    fixtures.nested,
    '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>\n',
    "utf8",
  );

  return fixtures;
}
