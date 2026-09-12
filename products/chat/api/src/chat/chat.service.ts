import type { Locale } from "@chat/contracts/common/locale";
import type { SessionId } from "@chat/contracts/chat/session";
import type { StreamRequest } from "@chat/contracts/chat/stream-request";
import type { ApiError } from "@chat/contracts/http/error";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SystemModelMessage } from "ai";
import {
  convertToModelMessages,
  createIdGenerator,
  isStepCount,
  pipeUIMessageStreamToResponse,
  smoothStream,
  toUIMessageStream,
  validateUIMessages,
} from "ai";
import { streamText } from "ai-sdk-ollama";
import type { ServerResponse } from "node:http";

import { AttachmentStoreService } from "../attachments/attachment-store.service.ts";
import { SandboxCacheService } from "../attachments/sandbox-cache.service.ts";
import type { AppConfig } from "../config/configuration.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { LlmService } from "../llm/llm.service.ts";
import { ReaderSessionService } from "../mcp/reader-session.service.ts";
import type { OwnerId } from "../owner/owner-id.ts";
import { approvalFor } from "../mcp/tool-approval.ts";
import { attachmentManifest } from "./attachment-manifest.ts";
import { ChatHistoryService } from "./chat-history.service.ts";

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

/**
 * Guard: without this the SDK leaves the response message's id empty, because it
 * only reuses an id when the last posted message is already an assistant message.
 * That id is the `external_id` half of `(session_id, external_id)`, so every
 * assistant turn in a conversation would collide on the same empty string: the
 * second answer would overwrite the first rather than append, and the history
 * would silently lose every reply but the newest.
 */
const messageId = createIdGenerator({ prefix: "msg", size: 16 });

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  private readonly approvalSecret: string | undefined;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly readers: ReaderSessionService,
    private readonly store: AttachmentStoreService,
    private readonly cache: SandboxCacheService,
    private readonly i18n: I18nService,
    private readonly llm: LlmService,
    private readonly history: ChatHistoryService,
  ) {
    this.approvalSecret = config.get("toolApprovalSecret", { infer: true });
  }

  async stream(
    request: StreamRequest,
    owner: OwnerId,
    response: ServerResponse,
    locale: Locale,
  ): Promise<void> {
    const messages = await validateUIMessages({ messages: request.messages });
    this.cache.touch(request.sessionId);

    const owned = await this.history.persist(
      owner,
      request.sessionId,
      messages,
    );
    if (!owned) {
      throw new HttpException(
        {
          code: "session_not_found",
          message: this.i18n.t("chat:errors.session_not_found", {}, locale),
        } satisfies ApiError,
        HttpStatus.NOT_FOUND,
      );
    }

    const abort = abortOnDisconnect(response);

    const manifest = await this.manifest(owner, request.sessionId, locale);

    const result = await streamText({
      model: this.llm.model(),
      instructions: [
        {
          role: "system",
          content: this.i18n.t("chat:system.instructions", {}, locale),
        },
        manifest,
      ],
      messages: await convertToModelMessages(messages),
      tools: await this.readers.toolsFor(owner, request.sessionId),
      stopWhen: isStepCount(STEP_LIMIT),
      timeout: this.llm.timeout,
      abortSignal: abort.signal,
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
        generateMessageId: messageId,
        onError: (cause) => this.renderError(cause, locale),
        onEnd: (event) => this.history.settle(owner, request.sessionId, event),
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
  private async manifest(
    owner: OwnerId,
    session: SessionId,
    locale: Locale,
  ): Promise<SystemModelMessage> {
    const { readable, images } = attachmentManifest(
      await this.store.list(owner, session),
    );

    const sections: string[] = [];
    if (readable.length > 0) {
      sections.push(
        `${this.i18n.t("chat:system.readable_files", {}, locale)}\n${readable.join("\n")}`,
      );
    }
    if (images.length > 0) {
      sections.push(
        `${this.i18n.t("chat:system.image_files", {}, locale)}\n${images.join("\n")}`,
      );
    }

    const files =
      sections.length === 0
        ? this.i18n.t("chat:system.no_files", {}, locale)
        : sections.join("\n\n");

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

/**
 * Guard: `pipeUIMessageStreamToResponse` never observes the socket. Its write
 * loop awaits a `drain` event that a destroyed socket will never emit, so a
 * client that navigates away mid-turn parks the read loop forever: the transform
 * is neither cancelled nor flushed, `onEnd` never runs, the assistant message is
 * never written, and the provider keeps generating into a dead connection.
 * Feeding this signal to `streamText` is what makes it enqueue a real abort
 * chunk, which reaches the flush through the normal path.
 */
function abortOnDisconnect(response: ServerResponse): AbortController {
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });

  return controller;
}
