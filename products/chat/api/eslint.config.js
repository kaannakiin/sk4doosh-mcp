import { config } from "@sk-mcp/eslint-config/base";
import { chatApp, chatUntrustedHttp } from "@sk-mcp/eslint-config/chat";

export default [
  ...config,
  ...chatApp,
  ...chatUntrustedHttp,
  { ignores: ["dist/**"] },
];
