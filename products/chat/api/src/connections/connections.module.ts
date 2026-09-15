import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module.ts";
import { ConnectionRepository } from "./connection.repository.ts";

@Module({
  imports: [DbModule],
  providers: [ConnectionRepository],
  exports: [ConnectionRepository],
})
export class ConnectionsModule {}
