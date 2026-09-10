import { config } from "@sk-mcp/eslint-config/react-internal";
import { chat } from "@sk-mcp/eslint-config/chat";

export default [
  ...config,
  ...chat,
  { ignores: [".tanstack/**", "dist/**", "src/routeTree.gen.ts"] },
];
