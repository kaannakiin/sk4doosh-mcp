import { Module } from "@nestjs/common";
import { SkMcpModule } from "@sk-mcp/sdk-nestjs";
import { AttachmentsController } from "./attachments.controller.js";
import { DemoAttachmentResolver } from "./attachments.js";
import { AuthController } from "./auth.controller.js";
import {
  AdminRoleGuard,
  BusinessHoursGuard,
  JwtGuard,
  OrdersReadGuard,
} from "./auth.js";
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
      options.visibility.tier = "probe";
      options.files.resolver = new DemoAttachmentResolver();
      if (process.env["DEMOAPI_QUERY_GROUPING"] === "group") {
        options.query.grouping = "group";
      }
    }),
  ],
  controllers: [
    AuthController,
    OrdersController,
    AttachmentsController,
    McpController,
  ],
  providers: [
    DemoOAuthProvider,
    AdminRoleGuard,
    BusinessHoursGuard,
    JwtGuard,
    OrdersReadGuard,
  ],
})
export class AppModule {}
