import { config } from "@sk-mcp/eslint-config/react-internal";
import { chatApp } from "@sk-mcp/eslint-config/chat";

export default [
  ...config,
  ...chatApp,
  { ignores: [".tanstack/**", "dist/**", "src/routeTree.gen.ts"] },
];
