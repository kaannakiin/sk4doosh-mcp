const skMcpPattern = {
  group: ["@sk-mcp/*"],
  message:
    "The chat product does not import sk-mcp product packages. Shared schemas live in @chat/contracts.",
};

/**
 * Guard: blocks the chat product line from importing sk-mcp product packages.
 * `@sk-mcp/sdk-nestjs` is on zod 3 while `@chat/contracts` is on zod 4; two zod
 * majors in one process make `instanceof ZodError` and schema identity fail
 * silently. Scoped to `src/**` so `eslint.config.js` and `tsconfig.json` can
 * still consume the shared toolchain packages.
 */
export const chat = [
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [skMcpPattern] },
      ],
    },
  },
];

/**
 * Guard: the two rules that keep the contract layer the single owner of every
 * schema, for `@chat/api` and `@chat/web`.
 *
 * A `zod` value import is refused because a schema declared next to the code
 * that consumes it drifts from the other side of the wire within one release;
 * type-only imports stay legal so a pipe can still name `ZodType`. A bare
 * `@chat/contracts` import is refused because the package publishes leaf
 * subpaths only: the barrel would pull every domain into the module graph,
 * which `@chat/api` pays for at runtime since it ships unbundled.
 */
export const chatApp = [
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@chat/contracts",
              message:
                "Import the leaf module instead, e.g. @chat/contracts/chat/send-message.",
            },
          ],
          patterns: [
            skMcpPattern,
            {
              group: ["zod", "zod/*"],
              allowTypeImports: true,
              message:
                "Schemas live in @chat/contracts. Import the schema from its leaf module; only type-only zod imports are allowed here.",
            },
          ],
        },
      ],
    },
  },
];
