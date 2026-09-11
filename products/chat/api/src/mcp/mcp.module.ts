import { Module } from "@nestjs/common";

import { AttachmentsModule } from "../attachments/attachments.module.ts";
import { ReaderSessionService } from "./reader-session.service.ts";

@Module({
  imports: [AttachmentsModule],
  providers: [ReaderSessionService],
  exports: [ReaderSessionService],
})
export class McpModule {}
