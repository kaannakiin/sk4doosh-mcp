import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  connectionSecret,
  createDbMcpServer,
  createDbSource,
  type DbSource,
} from "@sk-mcp/db-core";
import { mssqlDialect } from "./dialect/index.js";
import { createMssqlDriver, type MssqlDriverDeps } from "./driver/adapter.js";
import { asMssqlError, fail } from "./platform/errors.js";
import { limits } from "./platform/limits.js";
import { vocabulary } from "./platform/vocabulary.js";
import type { MssqlConfig } from "./platform/env.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export function createMssqlSource(
  config: MssqlConfig,
  deps: MssqlDriverDeps = {},
): DbSource<MssqlConfig> {
  return createDbSource(
    { dialect: mssqlDialect, vocabulary, fail, limits },
    {
      alias: config.database,
      secret: connectionSecret(config),
      display: {
        alias: config.database,
        engine: vocabulary.engineLabel,
        catalog: config.database,
        principal: config.user,
      },
    },
    createMssqlDriver(deps),
  );
}

export function createMssqlMcpServer(source: DbSource<MssqlConfig>): McpServer {
  return createDbMcpServer(
    { name: "sk-mcp-mssql", version: manifest.version },
    source,
    asMssqlError,
  );
}
