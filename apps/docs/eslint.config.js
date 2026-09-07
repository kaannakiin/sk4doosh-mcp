import { config } from "@sk-mcp/eslint-config/react-internal";

export default [
  ...config,
  { ignores: [".tanstack/**", "src/routeTree.gen.ts"] },
];
