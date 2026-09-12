import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module.ts";
import { OwnerMiddleware } from "./owner.middleware.ts";
import { OwnerService } from "./owner.service.ts";

@Module({
  imports: [DbModule],
  providers: [OwnerService, OwnerMiddleware],
  exports: [OwnerService, OwnerMiddleware],
})
export class OwnerModule {}
