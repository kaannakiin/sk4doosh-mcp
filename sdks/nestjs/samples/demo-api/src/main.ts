import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

const app = await NestFactory.create(AppModule);
await app.listen(3000);
console.log("demo-api: http://localhost:3000 (MCP endpoint: POST /mcp)");
