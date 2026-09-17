import { config } from "@sk-mcp/eslint-config/base";
import { casing } from "@sk-mcp/eslint-config/casing";

const primitivesMessage =
  "primitives/ is the dependency-free leaf; it may not import another layer or a package.";
const modelMessage =
  "model/ carries the vocabulary as types only; it may not import a runtime layer or a package.";
const xmlMessage =
  "xml/ reads a part with saxes; the container and the archive are above it.";
const zipMessage =
  "zip/ indexes the archive; the container layer is above it, and part parsing is not its job.";
const containerMessage =
  "container/ reads an OPC package through the injected PartSource; importing zip/ would make that injection decorative.";

const restrict = (message, { paths = [], folders = [] }) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: paths.map((name) => ({ name, message })),
      patterns: [
        { group: [...folders, "**/index.js", "**/reader.js"], message },
      ],
    },
  ],
});

export default [
  ...config,
  ...casing,
  {
    files: ["src/primitives/**/*.ts"],
    rules: restrict(primitivesMessage, {
      paths: ["fflate", "saxes"],
      folders: ["**/model/**", "**/xml/**", "**/zip/**", "**/container/**"],
    }),
  },
  {
    files: ["src/model/**/*.ts"],
    rules: restrict(modelMessage, {
      paths: ["fflate", "saxes"],
      folders: [
        "**/primitives/**",
        "**/xml/**",
        "**/zip/**",
        "**/container/**",
      ],
    }),
  },
  {
    files: ["src/xml/**/*.ts"],
    rules: restrict(xmlMessage, {
      paths: ["fflate"],
      folders: ["**/zip/**", "**/container/**"],
    }),
  },
  {
    files: ["src/zip/**/*.ts"],
    rules: restrict(zipMessage, {
      paths: ["saxes"],
      folders: ["**/xml/**", "**/container/**"],
    }),
  },
  {
    files: ["src/container/**/*.ts"],
    rules: restrict(containerMessage, {
      paths: ["fflate", "saxes"],
      folders: ["**/zip/**"],
    }),
  },
  { ignores: ["dist/**"] },
];
