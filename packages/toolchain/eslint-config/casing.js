export const casing = [
  {
    files: ["src/**/*.ts"],
    ignores: ["src/unicode.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^to(Lower|Upper)Case$/]",
          message:
            "Use fold, canonical, asciiLower or asciiUpper from @sk-mcp/file-core instead of locale-dependent casing.",
        },
      ],
    },
  },
];
