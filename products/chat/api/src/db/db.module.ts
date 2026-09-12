import { Module } from "@nestjs/common";

import { DbService } from "./db.service.ts";

@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
