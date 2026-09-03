import { Module } from "@nestjs/common";
import { SkMcpModule } from "@sk-mcp/sdk-nestjs";
import { AuthController } from "./auth.controller.js";
import { McpController } from "./mcp.controller.js";
import {
  demoIssuerUrl,
  demoResourceUrl,
  demoVerifier,
  DemoOAuthProvider,
} from "./oauth-provider.js";
import { OrdersController } from "./orders.controller.js";

@Module({
  imports: [
    SkMcpModule.forRoot((options) => {
      options.resourceServer = {
        resource: demoResourceUrl,
        authorizationServers: [demoIssuerUrl],
        resourceName: "demo-api",
        verifier: demoVerifier,
      };
    }),
  ],
  controllers: [AuthController, OrdersController, McpController],
  providers: [DemoOAuthProvider],
})
export class AppModule {}
