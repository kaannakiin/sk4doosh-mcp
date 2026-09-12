import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module.ts";
import { AttachmentStoreService } from "./attachment-store.service.ts";
import { ObjectStorageService } from "./object-storage.service.ts";
import { SandboxCacheService } from "./sandbox-cache.service.ts";

@Module({
  imports: [DbModule],
  providers: [
    AttachmentStoreService,
    ObjectStorageService,
    SandboxCacheService,
  ],
  exports: [AttachmentStoreService, ObjectStorageService, SandboxCacheService],
})
export class AttachmentsModule {}
