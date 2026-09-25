import { Module } from "@nestjs/common";

import { AttachmentsModule } from "../attachments/attachments.module.ts";
import { DbModule } from "../db/db.module.ts";
import { I18nModule } from "../i18n/i18n.module.ts";
import { ChatSessionRepository } from "../chat/chat-session.repository.ts";
import { CodexClientService } from "./codex-client.ts";
import { CodexRunnerService } from "./codex-runner.service.ts";
import { CodexToolService } from "./codex-tool.service.ts";
import { CodexWorkspaceService } from "./codex-workspace.service.ts";

@Module({
  imports: [AttachmentsModule, DbModule, I18nModule],
  providers: [
    ChatSessionRepository,
    CodexClientService,
    CodexRunnerService,
    CodexToolService,
    CodexWorkspaceService,
  ],
  exports: [CodexToolService, CodexWorkspaceService],
})
export class CodexModule {}
