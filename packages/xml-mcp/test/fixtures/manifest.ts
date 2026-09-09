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
