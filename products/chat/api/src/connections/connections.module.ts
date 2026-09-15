import { Module } from "@nestjs/common";

import { DbModule } from "../db/db.module.ts";
import { AuthorizationDiscoveryService } from "./authorization-discovery.service.ts";
import { ConnectionRepository } from "./connection.repository.ts";

@Module({
  imports: [DbModule],
  providers: [AuthorizationDiscoveryService, ConnectionRepository],
  exports: [AuthorizationDiscoveryService, ConnectionRepository],
})
export class ConnectionsModule {}
