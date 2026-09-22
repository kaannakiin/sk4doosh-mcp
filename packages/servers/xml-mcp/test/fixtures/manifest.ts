const maven = "http://maven.apache.org/POM/4.0.0";
const msbuild = "http://schemas.microsoft.com/developer/msbuild/2003";

export type ScenarioFile = keyof typeof files;

export interface ScenarioExpectation {
  readonly id: string;
  readonly file: ScenarioFile;
  readonly question: string;
  readonly expected: readonly string[];
  readonly forbidden: readonly string[];
  readonly maxCalls: number;
}

export const files = {
  pom: "pom.xml",
  invoice: "invoice.xml",
  legacyProject: "legacy.csproj",
  modernProject: "modern.csproj",
  mixed: "mixed.xml",
  malformed: "malformed.xml",
} as const;

export const namespaces = { maven, msbuild } as const;

export const scenarios: readonly ScenarioExpectation[] = [
  {
    id: "pom-dependency-version",
    file: "pom",
    question: "the version of the beta dependency in the Maven namespace",
    expected: ["2.3.4"],
    forbidden: ["9.9.9"],
    maxCalls: 3,
  },
  {
    id: "invoice-line-values",
    file: "invoice",
    question: "line identifiers and amounts, as written",
    expected: ["007", "0080", "10.50", "1234567890123456789"],
    forbidden: ["7", "80", "10.5", "1234567890123456800"],
    maxCalls: 3,
  },
  {
    id: "legacy-target-framework",
    file: "legacyProject",
    question: "the target framework of a namespaced project file",
    expected: ["net48"],
    forbidden: [],
    maxCalls: 3,
  },
  {
    id: "modern-target-framework",
    file: "modernProject",
    question: "the target framework of a project file with no namespace",
    expected: ["net9.0"],
    forbidden: [],
    maxCalls: 3,
  },
  {
    id: "mixed-content-order",
    file: "mixed",
    question: "the order and spacing of a mixed-content description",
    expected: ["lead ", "bold", "mid", " raw <tag> ", "remark", " tail "],
    forbidden: [],
    maxCalls: 2,
  },
  {
    id: "malformed-recovery",
    file: "malformed",
    question: "what to do with a document that is not well-formed",
    expected: ["malformed_xml"],
    forbidden: [],
    maxCalls: 2,
  },
];

export interface CorpusEntry {
  readonly id: string;
  readonly file: string;
  readonly xpath: string;
  readonly namespaces?: readonly {
    readonly prefix: string;
    readonly uri: string;
  }[];
  readonly expect: "nodeset" | "string" | "number" | "boolean" | "error";
  readonly code?: string;
}

const mavenBinding = [{ prefix: "m", uri: maven }] as const;

export const queryCorpus: readonly CorpusEntry[] = [
  { id: "root-element", file: "pom.xml", xpath: "/*", expect: "nodeset" },
  { id: "root-node", file: "pom.xml", xpath: "/", expect: "nodeset" },
  {
    id: "prefixed-descendants",
    file: "pom.xml",
    xpath: "//m:dependency",
    namespaces: mavenBinding,
    expect: "nodeset",
  },
  {
    id: "empty-by-default-namespace",
    file: "pom.xml",
    xpath: "//dependency",
    expect: "nodeset",
  },
  {
    id: "positional-predicate",
    file: "pom.xml",
    xpath: "(//m:dependency)[2]",
    namespaces: mavenBinding,
    expect: "nodeset",
  },
  {
    id: "union-out-of-order",
    file: "wide.xml",
    xpath: "//i[@k='3'] | //i[@k='1']",
    expect: "nodeset",
  },
  {
    id: "union-repeating-one-node",
    file: "wide.xml",
    xpath: "//i[@k='1'] | //i[@k='1']",
    expect: "nodeset",
  },
  {
    id: "reverse-axis",
    file: "deep.xml",
    xpath: "//n[last()]/ancestor::*",
    expect: "nodeset",
  },
  {
    id: "attribute-axis",
    file: "wide.xml",
    xpath: "//i/@k",
    expect: "nodeset",
  },
  { id: "text-nodes", file: "mixed.xml", xpath: "//text()", expect: "nodeset" },
  {
    id: "comments",
    file: "mixed.xml",
    xpath: "//comment()",
    expect: "nodeset",
  },
  {
    id: "processing-instructions",
    file: "mixed.xml",
    xpath: "//processing-instruction()",
    expect: "nodeset",
  },
  {
    id: "prolog-nodes",
    file: "prolog-nodes.xml",
    xpath: "/comment() | /processing-instruction()",
    expect: "nodeset",
  },
  { id: "count", file: "wide.xml", xpath: "count(//i)", expect: "number" },
  { id: "sum", file: "invoice.xml", xpath: "sum(//Qty)", expect: "number" },
  {
    id: "not-a-number",
    file: "wide.xml",
    xpath: "number('abc')",
    expect: "number",
  },
  { id: "infinity", file: "wide.xml", xpath: "1 div 0", expect: "number" },
  { id: "negative-zero", file: "wide.xml", xpath: "-0", expect: "number" },
  {
    id: "string-value",
    file: "invoice.xml",
    xpath: "string(//Amount)",
    expect: "string",
  },
  {
    id: "big-integer-stays-text",
    file: "invoice.xml",
    xpath: "string(//Line[2]/Amount)",
    expect: "string",
  },
  {
    id: "boolean-false",
    file: "wide.xml",
    xpath: "boolean(//nothing)",
    expect: "boolean",
  },
  {
    id: "quoted-name-is-not-a-prefix",
    file: "wide.xml",
    xpath: "//i[@k='zz:1']",
    expect: "nodeset",
  },
  {
    id: "unbound-prefix",
    file: "pom.xml",
    xpath: "//zz:dependency",
    expect: "error",
    code: "invalid_argument",
  },
  {
    id: "later-version-function",
    file: "pom.xml",
    xpath: "//m:dependency[matches(., 'a')]",
    namespaces: mavenBinding,
    expect: "error",
    code: "query_not_supported",
  },
  {
    id: "namespace-axis",
    file: "pom.xml",
    xpath: "//namespace::*",
    expect: "error",
    code: "query_not_supported",
  },
  {
    id: "syntax-fault",
    file: "pom.xml",
    xpath: "//[",
    expect: "error",
    code: "invalid_argument",
  },
  {
    id: "unclosed-predicate",
    file: "pom.xml",
    xpath: "//m:dependency[1",
    namespaces: mavenBinding,
    expect: "error",
    code: "invalid_argument",
  },
  {
    id: "misspelled-function",
    file: "pom.xml",
    xpath: "countt(//*)",
    expect: "error",
    code: "invalid_argument",
  },
  {
    id: "malformed-document",
    file: "malformed.xml",
    xpath: "//*",
    expect: "error",
    code: "malformed_xml",
  },
  {
    id: "doctype-document",
    file: "doctype.xml",
    xpath: "//*",
    expect: "error",
    code: "doctype_not_allowed",
  },
];

export const expectedTargetFrameworkAddress = {
  legacy: [
    { namespaceUri: msbuild, localName: "Project", occurrence: 1 },
    { namespaceUri: msbuild, localName: "PropertyGroup", occurrence: 1 },
    { namespaceUri: msbuild, localName: "TargetFramework", occurrence: 1 },
  ],
  modern: [
    { namespaceUri: "", localName: "Project", occurrence: 1 },
    { namespaceUri: "", localName: "PropertyGroup", occurrence: 1 },
    { namespaceUri: "", localName: "TargetFramework", occurrence: 1 },
  ],
} as const;
