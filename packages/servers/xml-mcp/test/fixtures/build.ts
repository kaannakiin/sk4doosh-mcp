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
  readonly mixed: string;
  readonly namespaceTraps: string;
  readonly invoice: string;
  readonly deep: string;
  readonly wide: string;
  readonly heavyPages: string;
  readonly oversizedNode: string;
  readonly utf32leDoctype: string;
  readonly utf32beDoctype: string;
  readonly utf32leClean: string;
  readonly ebcdicDoctype: string;
  readonly pom: string;
  readonly modernProject: string;
  readonly junit: string;
  readonly prologNodes: string;
  readonly records: string;
  readonly amounts: string;
  readonly wideQuery: string;
  readonly heavyQuery: string;
  readonly cdataFalseBoundary: string;
  readonly commentFalseBoundary: string;
  readonly attrFalseBoundary: string;
  readonly piFalseBoundary: string;
  readonly nestedSameName: string;
  readonly recordsUtf16: string;
  readonly recordsLatin: string;
  readonly recordsNamespaced: string;
}

const utf16le = (text: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

function utf32(text: string, littleEndian: boolean, bom: boolean): Buffer {
  const parts: Buffer[] = [];
  if (bom) {
    parts.push(
      Buffer.from(
        littleEndian ? [0xff, 0xfe, 0x00, 0x00] : [0x00, 0x00, 0xfe, 0xff],
      ),
    );
  }
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    const unit = Buffer.alloc(4);
    if (littleEndian) unit.writeUInt32LE(point);
    else unit.writeUInt32BE(point);
    parts.push(unit);
  }
  return Buffer.concat(parts);
}

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
    mixed: join(root, "mixed.xml"),
    namespaceTraps: join(root, "traps.xml"),
    invoice: join(root, "invoice.xml"),
    deep: join(root, "deep.xml"),
    wide: join(root, "wide.xml"),
    heavyPages: join(root, "heavy-pages.xml"),
    oversizedNode: join(root, "oversized-node.xml"),
    utf32leDoctype: join(root, "utf32le-doctype.xml"),
    utf32beDoctype: join(root, "utf32be-doctype.xml"),
    utf32leClean: join(root, "utf32le-clean.xml"),
    ebcdicDoctype: join(root, "ebcdic-doctype.xml"),
    pom: join(root, "pom.xml"),
    modernProject: join(root, "modern.csproj"),
    junit: join(root, "junit.xml"),
    prologNodes: join(root, "prolog-nodes.xml"),
    records: join(root, "records.xml"),
    amounts: join(root, "amounts.xml"),
    wideQuery: join(root, "wide-query.xml"),
    heavyQuery: join(root, "heavy-query.xml"),
    cdataFalseBoundary: join(root, "cdata-boundary.xml"),
    commentFalseBoundary: join(root, "comment-boundary.xml"),
    attrFalseBoundary: join(root, "attr-boundary.xml"),
    piFalseBoundary: join(root, "pi-boundary.xml"),
    nestedSameName: join(root, "nested-same-name.xml"),
    recordsUtf16: join(root, "records-utf16.xml"),
    recordsLatin: join(root, "records-latin.xml"),
    recordsNamespaced: join(root, "records-namespaced.xml"),
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

  await writeFile(
    fixtures.mixed,
    '<?xml version="1.0"?>\n' +
      '<note xml:space="preserve">lead <b>bold</b> mid' +
      '<?render mode="fast"?>' +
      "<![CDATA[ raw <tag> ]]>" +
      "<!--remark-->" +
      " tail </note>\n",
    "utf8",
  );
  await writeFile(
    fixtures.namespaceTraps,
    '<?xml version="1.0"?>\n' +
      '<root xmlns="urn:default" xmlns:a="urn:alpha">' +
      "<id>default-one</id>" +
      "<a:id>alpha-one</a:id>" +
      '<child xmlns:a="urn:beta"><a:id>beta-one</a:id></child>' +
      '<plain kind="bare" a:kind="qualified"/>' +
      "</root>\n",
    "utf8",
  );
  await writeFile(
    fixtures.invoice,
    '<?xml version="1.0"?>\n' +
      "<Invoice>" +
      "<Line><Id>007</Id><Qty>0</Qty><Amount>10.50</Amount><Paid>false</Paid><Note></Note></Line>" +
      "<Line><Id>0080</Id><Qty>12</Qty><Amount>1234567890123456789</Amount><Paid>true</Paid><Note/></Line>" +
      "</Invoice>\n",
    "utf8",
  );
  await writeFile(
    fixtures.deep,
    `<d>${"<n>".repeat(12)}leaf${"</n>".repeat(12)}</d>\n`,
    "utf8",
  );
  await writeFile(
    fixtures.wide,
    `<w>${Array.from({ length: 40 }, (_, index) => `<i k="${String(index)}">v${String(index)}</i>`).join("")}</w>\n`,
    "utf8",
  );

  const padding = "p".repeat(500);
  await writeFile(
    fixtures.heavyPages,
    `<h>${Array.from(
      { length: 220 },
      (_, index) =>
        `<row ${Array.from(
          { length: 12 },
          (__, slot) => `a${String(slot)}="${padding}"`,
        ).join(" ")}>${String(index)}</row>`,
    ).join("")}</h>\n`,
    "utf8",
  );
  await writeFile(
    fixtures.oversizedNode,
    `<big ${Array.from(
      { length: 4000 },
      (_, index) => `a${String(index)}="${"v".repeat(200)}"`,
    ).join(" ")}/>\n`,
    "utf8",
  );

  const doctypeSource =
    '<!DOCTYPE catalog [<!ENTITY x "expanded">]><catalog>&x;</catalog>';
  await writeFile(fixtures.utf32leDoctype, utf32(doctypeSource, true, true));
  await writeFile(fixtures.utf32beDoctype, utf32(doctypeSource, false, false));
  await writeFile(fixtures.utf32leClean, utf32("<catalog/>", true, false));
  await writeFile(
    fixtures.ebcdicDoctype,
    Buffer.from([
      0x4c, 0x6f, 0xa7, 0x94, 0x93, 0x40, 0xa5, 0x85, 0x99, 0xa2, 0x89, 0x96,
      0x95, 0x7e, 0x7f, 0xf1, 0x4b, 0xf0, 0x7f, 0x6f, 0x6e,
    ]),
  );

  await writeFile(
    fixtures.pom,
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:t="urn:trap">' +
      "<dependencies>" +
      "<dependency><groupId>org.a</groupId><artifactId>alpha</artifactId><version>1.0.0</version></dependency>" +
      "<dependency><groupId>org.b</groupId><artifactId>beta</artifactId><version>2.3.4</version></dependency>" +
      "</dependencies>" +
      "<t:dependency><t:artifactId>beta</t:artifactId><t:version>9.9.9</t:version></t:dependency>" +
      "</project>\n",
    "utf8",
  );
  await writeFile(
    fixtures.modernProject,
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>\n',
    "utf8",
  );

  await writeFile(
    fixtures.junit,
    '<?xml version="1.0"?>\n' +
      "<testsuites>" +
      '<testsuite name="suite.one" tests="3">' +
      '<testcase name="passes" classname="Alpha"/>' +
      '<testcase name="breaks" classname="Alpha">' +
      '<failure message="expected 2 but was 3">at Alpha.breaks(Alpha.java:11)</failure>' +
      "</testcase>" +
      '<testcase name="throws" classname="Beta">' +
      '<failure message="null pointer">at Beta.throws(Beta.java:4)</failure>' +
      "</testcase>" +
      "</testsuite>" +
      '<testsuite name="suite.two" tests="1">' +
      '<testcase name="skipped" classname="Gamma"><skipped/></testcase>' +
      "</testsuite>" +
      "</testsuites>\n",
    "utf8",
  );

  await writeFile(
    fixtures.prologNodes,
    '<?xml version="1.0"?>\n' +
      "<!-- prolog remark -->\n" +
      '<?prolog-instruction mode="early"?>\n' +
      '<root xmlns="urn:default"><id>one</id><?body-instruction go?><!--inner remark--></root>\n',
    "utf8",
  );

  await writeFile(
    fixtures.records,
    '<?xml version="1.0"?>\n' +
      "<catalogue>" +
      '<entry code="a"><name>alpha</name><tag>x</tag></entry>' +
      '<entry code="b"><name></name><tag>x</tag><tag>y</tag></entry>' +
      '<entry code="c"><tag>z</tag></entry>' +
      '<entry code="d"><name>lead<em>mid</em>tail</name></entry>' +
      "<other><name>ignored</name></other>" +
      '<entry code="e"><name>epsilon</name></entry>' +
      "</catalogue>\n",
    "utf8",
  );

  await writeFile(
    fixtures.amounts,
    '<?xml version="1.0"?>\n' +
      "<ledger>" +
      "<row><cur>TRY</cur><amount>10.50</amount></row>" +
      "<row><cur>TRY</cur><amount>10.10</amount></row>" +
      "<row><cur>TRY</cur><amount>abc</amount></row>" +
      "<row><cur>EUR</cur><amount>1e400</amount></row>" +
      "<row><cur>EUR</cur><amount>-0</amount></row>" +
      "<row><cur>EUR</cur><amount/></row>" +
      "<row><cur>USD</cur></row>" +
      "<row><cur>HUGE</cur><amount>1234567890123456789</amount></row>" +
      "</ledger>\n",
    "utf8",
  );

  await writeFile(
    fixtures.wideQuery,
    `<catalogue>${Array.from(
      { length: 300 },
      (_, index) =>
        `<entry code="c${String(index)}"><name>n${String(index)}</name></entry>`,
    ).join("")}</catalogue>\n`,
    "utf8",
  );

  const wrappers = 45;
  const cellText = "z".repeat(600);
  await writeFile(
    fixtures.heavyQuery,
    `${"<wrapper>".repeat(wrappers)}${Array.from(
      { length: 250 },
      () => `<cell>${cellText}</cell>`,
    ).join("")}${"</wrapper>".repeat(wrappers)}\n`,
    "utf8",
  );

  await writeFile(
    fixtures.cdataFalseBoundary,
    '<?xml version="1.0"?>\n' +
      "<catalogue>" +
      '<entry code="a"><name><![CDATA[</entry><entry code="ghost">]]></name></entry>' +
      '<entry code="b"><name>beta</name></entry>' +
      "</catalogue>\n",
    "utf8",
  );

  await writeFile(
    fixtures.commentFalseBoundary,
    '<?xml version="1.0"?>\n' +
      "<catalogue>" +
      '<entry code="a"><!-- </entry><entry code="ghost"> --><name>alpha</name></entry>' +
      '<entry code="b"><name>beta</name></entry>' +
      "</catalogue>\n",
    "utf8",
  );

  await writeFile(
    fixtures.attrFalseBoundary,
    '<?xml version="1.0"?>\n' +
      "<catalogue>" +
      '<entry code="a" note="x &gt; y /&gt; z" tail=\'a > b /> c\'>' +
      "<name>alpha</name></entry>" +
      '<entry code="b" note=\'say "hi" &gt;\' tail="it\'s > fine"><name>beta</name></entry>' +
      "</catalogue>\n",
    "utf8",
  );

  await writeFile(
    fixtures.piFalseBoundary,
    '<?xml version="1.0"?>\n' +
      "<catalogue>" +
      '<entry code="a"><?ghost </entry><entry code="ghost"> ?><name>alpha</name></entry>' +
      '<entry code="b"><name>beta</name></entry>' +
      "</catalogue>\n",
    "utf8",
  );

  await writeFile(
    fixtures.nestedSameName,
    '<?xml version="1.0"?>\n' +
      "<catalogue>" +
      '<entry code="a"/>' +
      '<entry code="b"><entry code="inner"><name>deep</name></entry><name>beta</name></entry>' +
      '<entry code="c"><name>gamma</name></entry>' +
      "</catalogue>\n",
    "utf8",
  );

  await writeFile(
    fixtures.recordsUtf16,
    utf16le(
      '<?xml version="1.0" encoding="UTF-16"?>\n' +
        "<catalogue>" +
        '<entry code="a"><name>alpha</name></entry>' +
        '<entry code="b"><name>beta</name></entry>' +
        "</catalogue>\n",
    ),
  );

  await writeFile(
    fixtures.recordsLatin,
    Buffer.from(
      '<?xml version="1.0" encoding="windows-1254"?>\n' +
        "<catalogue>" +
        '<entry code="a"><name>alpha</name></entry>' +
        '<entry code="b"><name>beta</name></entry>' +
        "</catalogue>\n",
      "latin1",
    ),
  );

  await writeFile(
    fixtures.recordsNamespaced,
    '<?xml version="1.0"?>\n' +
      '<catalogue xmlns="urn:cat" xmlns:m="urn:meta" xml:lang="tr" xml:space="preserve">' +
      '<entry code="a" m:rank="1"><name>alpha</name></entry>' +
      '<entry code="b" m:rank="2"><name>beta</name></entry>' +
      "</catalogue>\n",
    "utf8",
  );

  return fixtures;
}
