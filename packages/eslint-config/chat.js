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
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@sk-mcp/*"],
              message:
                "The chat product does not import sk-mcp product packages. Shared schemas live in @chat/contracts.",
            },
          ],
        },
      ],
    },
  },
];
