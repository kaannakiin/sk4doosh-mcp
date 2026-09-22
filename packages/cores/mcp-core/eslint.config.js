import { config } from "@sk-mcp/eslint-config/base";
import { casing } from "@sk-mcp/eslint-config/casing";

export default [...config, ...casing, { ignores: ["dist/**"] }];
