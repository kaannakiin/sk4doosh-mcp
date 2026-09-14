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
const trustProxyHops = config.get("trustProxyHops", { infer: true });
const pathPrefix = config.get("pathPrefix", { infer: true });

if (trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

/**
 * Guard: a chat turn posts the whole UI message history, tool inputs and tool
 * outputs included, so Express's 100 KB JSON default rejects a normal
 * conversation about a spreadsheet within a few turns.
 */
app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
app.use(cookieParser());
/**
 * Guard: the prefix is mounted here rather than left to a proxy rewrite. The
 * auth cookies are scoped to paths derived from it, and a rewrite that strips
 * the prefix before express sees it leaves the browser holding cookies whose
 * path can never match the url it requests.
 */
app.setGlobalPrefix(pathPrefix);
app.enableShutdownHooks();
/**
 * Guard: auth cookies are the only accepted session transport. The web dev server
 * proxies this api under its own origin; deployments on a separate allowed origin
 * need credentialed CORS for the browser to include them.
 */
app.enableCors({
  origin: config.get("corsOrigin", { infer: true }),
  credentials: true,
});

await app.listen(port, "127.0.0.1");
console.log(`chat api: http://127.0.0.1:${port}${pathPrefix}`);
