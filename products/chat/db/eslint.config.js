import { config } from "@sk-mcp/eslint-config/base";
import { chat } from "@sk-mcp/eslint-config/chat";

export default [
  ...config,
  ...chat,
  { ignores: ["dist/**", "src/generated/**"] },
];
