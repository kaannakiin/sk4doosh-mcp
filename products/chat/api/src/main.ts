import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module.ts";
import type { AppConfig } from "./config/configuration.ts";

const JSON_BODY_LIMIT = "8mb";

const app = await NestFactory.create<NestExpressApplication>(AppModule);
const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
const port = config.get("port", { infer: true });

/**
 * Guard: a chat turn posts the whole UI message history, tool inputs and tool
 * outputs included, so Express's 100 KB JSON default rejects a normal
 * conversation about a spreadsheet within a few turns.
 */
app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
app.enableShutdownHooks();
app.enableCors({ origin: config.get("corsOrigin", { infer: true }) });

await app.listen(port, "127.0.0.1");
console.log(`chat api: http://127.0.0.1:${port}`);
