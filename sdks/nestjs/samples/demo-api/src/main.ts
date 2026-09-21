import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { AppModule } from "./app.module.js";
import {
  demoIssuerUrl,
  demoResourceUrl,
  DemoOAuthProvider,
} from "./oauth-provider.js";

const app = await NestFactory.create(AppModule);
/**
 * Express 5 defaults `query parser` to `simple`, which delivers `?filter[owner]=x` as one literal
 * key. The bracket notation the NestJS SDK writes needs the extended parser, and the catalog
 * refuses to start with `query_parser_not_extended` without it.
 */
app.getHttpAdapter().getInstance().set("query parser", "extended");
app.useGlobalPipes(new ValidationPipe({ transform: true }));
app.use(hostHeaderValidation(["localhost", "127.0.0.1"]));
app.use(
  mcpAuthRouter({
    provider: app.get(DemoOAuthProvider),
    issuerUrl: demoIssuerUrl,
    resourceServerUrl: demoResourceUrl,
  }),
);
await app.init();

await app.listen(3000);
console.log("demo-api: http://localhost:3000 (MCP endpoint: POST /mcp)");
