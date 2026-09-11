import { Module } from "@nestjs/common";

import { AttachmentStoreService } from "./attachment-store.service.ts";

@Module({
  providers: [AttachmentStoreService],
  exports: [AttachmentStoreService],
})
export class AttachmentsModule {}
