import type { Locale } from "@chat/contracts/common/locale";
import type { SessionId } from "@chat/contracts/chat/session";
import type { StreamRequest } from "@chat/contracts/chat/stream-request";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SystemModelMessage } from "ai";
import {
  convertToModelMessages,
  isStepCount,
  pipeUIMessageStreamToResponse,
  smoothStream,
  toUIMessageStream,
  validateUIMessages,
} from "ai";
import { streamText } from "ai-sdk-ollama";
import type { ServerResponse } from "node:http";

import { AttachmentStoreService } from "../attachments/attachment-store.service.ts";
import type { AppConfig } from "../config/configuration.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { LlmService } from "../llm/llm.service.ts";
import { ReaderSessionService } from "../mcp/reader-session.service.ts";
import { approvalFor } from "../mcp/tool-approval.ts";
import { attachmentManifest } from "./attachment-manifest.ts";

/**
 * One step is one model generation. A read that needs describe, then read, then
 * a narration is three; the budget leaves room for a follow-up query without
 * letting a confused model loop on the same sheet.
 *
 * Guard: `streamText` defaults `stopWhen` to `isStepCount(1)`, which returns the
 * tool call and stops before the model ever says anything about the result. The
 * 20-step default belongs to `ToolLoopAgent`, not here.
 */
const STEP_LIMIT = 8;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  private readonly approvalSecret: string | undefined;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly readers: ReaderSessionService,
    private readonly store: AttachmentStoreService,
    private readonly i18n: I18nService,
    private readonly llm: LlmService,
  ) {
    this.approvalSecret = config.get("toolApprovalSecret", { infer: true });
  }

  async stream(
    request: StreamRequest,
    response: ServerResponse,
    locale: Locale,
  ): Promise<void> {
    const messages = await validateUIMessages({ messages: request.messages });
    this.store.touch(request.sessionId);

    const result = await streamText({
      model: this.llm.model(),
      instructions: [
        {
          role: "system",
          content: this.i18n.t("chat:system.instructions", {}, locale),
        },
        this.manifest(request.sessionId, locale),
      ],
      messages: await convertToModelMessages(messages),
      tools: await this.readers.toolsFor(request.sessionId),
      stopWhen: isStepCount(STEP_LIMIT),
      timeout: this.llm.timeoutMs,
      experimental_toolApprovalSecret: this.approvalSecret,
      experimental_transform: smoothStream(),
      toolApproval: ({ toolCall }) =>
        approvalFor(
          { toolName: toolCall.toolName, dynamic: toolCall.dynamic === true },
          (key) => this.i18n.t(key, {}, locale),
        ),
    });

    await pipeUIMessageStreamToResponse({
      response,
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
        onError: (cause) => this.renderError(cause, locale),
      }),
    });
  }

  /**
   * Guard: this is a second entry in `instructions`, never an extra element of
   * `messages`. `collectToolApprovals` in the SDK resumes an approved tool call
   * only when the last model message is the `tool` message carrying the approval
   * response — anything appended after it makes the approval invisible, the tool
   * never runs, and the provider receives a tool call with no result. The
   * observed failure is an empty assistant turn plus an infinite auto-resend
   * loop, because `lastAssistantMessageIsCompleteWithApprovalResponses` on the
   * client stays true for a part that can never leave `approval-responded`.
   */
  private manifest(session: SessionId, locale: Locale): SystemModelMessage {
    const attachments = this.store.list(session);
    const files =
      attachments.length === 0
        ? this.i18n.t("chat:system.no_files", {}, locale)
        : attachmentManifest(attachments);

    return {
      role: "system",
      content: this.i18n.t("chat:system.files", { files }, locale),
    };
  }

  /**
   * Guard: the AI SDK masks stream errors by default so provider internals do
   * not reach the browser. Replacing that default means the replacement has to
   * mask too — the real cause goes to the log, the client gets one localized
   * sentence.
   */
  private renderError(cause: unknown, locale: Locale): string {
    this.logger.error(cause instanceof Error ? cause.stack : String(cause));

    return this.i18n.t("chat:errors.stream_failed", {}, locale);
  }
}
