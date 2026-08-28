import { config } from "@sk-mcp/eslint-config/base";

export default [...config, { ignores: ["dist/**", "src/generated/**"] }];
