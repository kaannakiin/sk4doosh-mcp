import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";

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
app.use(cookieParser());
app.enableShutdownHooks();
/**
 * Guard: `credentials` is on because the owner cookie is the only thing that
 * scopes a read. It is unused while the web dev server proxies this api under its
 * own origin — which is the supported setup — and is what a deployment serving
 * the api on its own host needs instead.
 */
app.enableCors({
  origin: config.get("corsOrigin", { infer: true }),
  credentials: true,
});

await app.listen(port, "127.0.0.1");
console.log(`chat api: http://127.0.0.1:${port}`);
