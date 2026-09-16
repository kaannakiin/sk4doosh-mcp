import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.ts";
import { NoStoreInterceptor } from "../auth/no-store.interceptor.ts";
import { DbModule } from "../db/db.module.ts";
import { I18nModule } from "../i18n/i18n.module.ts";
import { AuthorizationDiscoveryService } from "./authorization-discovery.service.ts";
import { ClientRegistrationService } from "./client-registration.service.ts";
import { ConnectionAttemptRepository } from "./connection-attempt.repository.ts";
import { ConnectionAuthorizationService } from "./connection-authorization.service.ts";
import { ConnectionRevocationService } from "./connection-revocation.service.ts";
import { ConnectionTokenService } from "./connection-token.service.ts";
import { ConnectionRepository } from "./connection.repository.ts";
import { ConnectionsController } from "./connections.controller.ts";
import { CredentialCipherService } from "./credential-cipher.service.ts";
import { IntegrationAuthorizationRepository } from "./integration-authorization.repository.ts";
import { IntegrationAuthorizationService } from "./integration-authorization.service.ts";
import { IntegrationRegistrationService } from "./integration-registration.service.ts";
import { IntegrationRepository } from "./integration.repository.ts";
import { IntegrationToolsService } from "./integration-tools.service.ts";
import { IntegrationsController } from "./integrations.controller.ts";

const providers = [
  AuthorizationDiscoveryService,
  ClientRegistrationService,
  ConnectionAttemptRepository,
  ConnectionAuthorizationService,
  ConnectionRevocationService,
  ConnectionTokenService,
  ConnectionRepository,
  CredentialCipherService,
  IntegrationAuthorizationRepository,
  IntegrationAuthorizationService,
  IntegrationRegistrationService,
  IntegrationRepository,
  IntegrationToolsService,
];

@Module({
  imports: [DbModule, AuthModule, I18nModule],
  controllers: [ConnectionsController, IntegrationsController],
  providers: [...providers, NoStoreInterceptor],
  exports: providers,
})
export class ConnectionsModule {}
