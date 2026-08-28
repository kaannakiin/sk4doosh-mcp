import { Module } from "@nestjs/common";
import { SkMcpModule } from "@sk-mcp/sdk-nestjs";
import { AuthController } from "./auth.controller.js";
import { McpController } from "./mcp.controller.js";
import { OrdersController } from "./orders.controller.js";

@Module({
  imports: [SkMcpModule.forRoot()],
  controllers: [AuthController, OrdersController, McpController],
})
export class AppModule {}
