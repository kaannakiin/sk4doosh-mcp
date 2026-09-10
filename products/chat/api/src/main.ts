import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.ts";
import type { AppConfig } from "./config/configuration.ts";

const app = await NestFactory.create(AppModule);
const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
const port = config.get("port", { infer: true });

app.enableCors({ origin: config.get("corsOrigin", { infer: true }) });

await app.listen(port, "127.0.0.1");
console.log(`chat api: http://127.0.0.1:${port}`);
