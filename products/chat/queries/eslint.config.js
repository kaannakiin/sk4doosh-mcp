import { chatApp } from "@sk-mcp/eslint-config/chat";
import { config } from "@sk-mcp/eslint-config/react-internal";

export default [...config, ...chatApp, { ignores: ["dist/**"] }];
