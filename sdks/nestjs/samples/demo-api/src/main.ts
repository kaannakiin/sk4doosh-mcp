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
app.useGlobalPipes(new ValidationPipe({ transform: true }));
app.use(hostHeaderValidation(["localhost", "127.0.0.1"]));

await app.init();

app.use(
  mcpAuthRouter({
    provider: app.get(DemoOAuthProvider),
    issuerUrl: demoIssuerUrl,
    resourceServerUrl: demoResourceUrl,
  }),
);
await app.listen(3000);
console.log("demo-api: http://localhost:3000 (MCP endpoint: POST /mcp)");
