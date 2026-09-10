import { config } from "@sk-mcp/eslint-config/base";
import { chatApp } from "@sk-mcp/eslint-config/chat";

export default [...config, ...chatApp, { ignores: ["dist/**"] }];
