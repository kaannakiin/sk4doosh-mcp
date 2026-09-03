import { config } from "@sk-mcp/eslint-config/base";

export default [
  ...config,
  { ignores: ["dist/**"] },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/unicode.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^to(Lower|Upper)Case$/]",
          message:
            "Use fold, canonical, asciiLower or asciiUpper from ./unicode.js instead of locale-dependent casing.",
        },
      ],
    },
  },
];
