import { attachmentIdSchema } from "@chat/contracts/attachment/attachment";
import {
  presignQuerySchema,
  type PresignQuery,
  type PresignedUrlResponse,
} from "@chat/contracts/attachment/presign";
import type {
  AttachmentListResponse,
  UploadResponse,
} from "@chat/contracts/attachment/upload";
import { sessionIdSchema, type SessionId } from "@chat/contracts/chat/session";
import { SESSION_HISTORY_LIMIT_DEFAULT } from "@chat/contracts/chat/session-limits";
import type { SessionDetailResponse } from "@chat/contracts/chat/session-detail";
import {
  sessionRenameSchema,
  type SessionRename,
} from "@chat/contracts/chat/session-rename";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import {
  sessionListQuerySchema,
  type SessionListQuery,
  type SessionListResponse,
} from "@chat/contracts/chat/session-page";
import {
  streamRequestSchema,
  type StreamRequest,
} from "@chat/contracts/chat/stream-request";
import type { ApiError } from "@chat/contracts/http/error";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";

import {
  AttachmentStoreService,
  type UploadedFile as StoredUpload,
} from "../attachments/attachment-store.service.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import type { RequestWithLocale } from "../i18n/request-locale.ts";
import { SandboxCacheService } from "../attachments/sandbox-cache.service.ts";
import { ReaderSessionService } from "../mcp/reader-session.service.ts";
import type { OwnerId } from "../owner/owner-id.ts";
import type { RequestWithOwner } from "../owner/request-owner.ts";
import { ChatHistoryService } from "./chat-history.service.ts";
import { ChatService } from "./chat.service.ts";

type ChatRequest = RequestWithLocale & RequestWithOwner;

@Controller("chat")
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly history: ChatHistoryService,
    private readonly store: AttachmentStoreService,
    private readonly readers: ReaderSessionService,
    private readonly cache: SandboxCacheService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Guard: `@Res()` puts this route in library-specific mode, which the Nest
   * docs note gives up interceptors and the `@HttpCode()`/`@Header()`
   * decorators — none of which this route uses. Parameter pipes still run
   * first, so an invalid envelope is a localized 422 before a single stream
   * byte is written. The AI SDK's UI message stream is not an `Observable` of
   * `MessageEvent`, so `@Sse()` cannot carry it.
   */
  @Post()
  async stream(
    @Body({ schema: streamRequestSchema }) body: StreamRequest,
    @Req() request: ChatRequest,
    @Res() response: Response,
  ): Promise<void> {
    await this.chat.stream(
      body,
      this.ownerOf(request),
      response,
      this.localeOf(request),
    );
  }

  @Get("sessions")
  async sessions(
    @Query({ schema: sessionListQuerySchema }) query: SessionListQuery,
    @Req() request: ChatRequest,
  ): Promise<SessionListResponse> {
    return this.history.list(this.ownerOf(request), query);
  }

  /**
   * Guard: a session this owner does not have reads as `not_found`, never as
   * `forbidden`. A 403 confirms that a guessed id names a real conversation,
   * which turns a client-minted uuid into something worth enumerating.
   */
  @Get("sessions/:sessionId")
  async session(
    @Param("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
    @Req() request: ChatRequest,
  ): Promise<SessionDetailResponse> {
    const detail = await this.history.load(
      this.ownerOf(request),
      sessionId,
      SESSION_HISTORY_LIMIT_DEFAULT,
    );
    if (detail === undefined) {
      throw this.fail("session_not_found", HttpStatus.NOT_FOUND);
    }

    return {
      ...detail,
      attachments: await this.store.list(this.ownerOf(request), sessionId),
    };
  }

  /**
   * Releases the local resources a session holds without deleting it.
   *
   * Guard: this is deliberately not `DELETE`. Under indefinite retention the two
   * verbs mean opposite things — one drops reader processes and cached files, the
   * other destroys the conversation — and the route that a page unload might call
   * must be the harmless one.
   */
  @Post("sessions/:sessionId/release")
  @HttpCode(HttpStatus.NO_CONTENT)
  async release(
    @Param("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
  ): Promise<void> {
    await this.readers.release(sessionId);
    await this.cache.evictSession(sessionId);
  }

  @Patch("sessions/:sessionId")
  async rename(
    @Param("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
    @Body({ schema: sessionRenameSchema }) body: SessionRename,
    @Req() request: ChatRequest,
  ): Promise<SessionSummary> {
    const renamed = await this.history.rename(
      this.ownerOf(request),
      sessionId,
      body.title,
    );
    if (renamed === undefined) {
      throw this.fail("session_not_found", HttpStatus.NOT_FOUND);
    }

    return renamed;
  }

  @Delete("sessions/:sessionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSession(
    @Param("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
    @Req() request: ChatRequest,
  ): Promise<void> {
    const removed = await this.history.remove(this.ownerOf(request), sessionId);
    if (!removed) {
      throw this.fail("session_not_found", HttpStatus.NOT_FOUND);
    }

    await this.readers.release(sessionId);
    await this.cache.evictSession(sessionId);
  }

  @Post("files")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @Query("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
    @UploadedFile() file: StoredUpload | undefined,
    @Req() request: ChatRequest,
  ): Promise<UploadResponse> {
    if (file === undefined) {
      throw this.fail("file_missing", HttpStatus.BAD_REQUEST);
    }

    return this.store.put(this.ownerOf(request), sessionId, file);
  }

  @Get("files")
  async list(
    @Query("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
    @Req() request: ChatRequest,
  ): Promise<AttachmentListResponse> {
    return {
      attachments: await this.store.list(this.ownerOf(request), sessionId),
    };
  }

  /**
   * Mints a short-lived url the browser fetches straight from the object store.
   *
   * Guard: this route performs no storage i/o — presigning is a local signature.
   * Checking that the object exists first would turn a dependency-free route into
   * one that fails when the store is down, and double its latency for a guarantee
   * that is stale the moment it returns.
   */
  @Get("files/:attachmentId/url")
  async presign(
    @Param("attachmentId", { schema: attachmentIdSchema }) attachmentId: string,
    @Query({ schema: presignQuerySchema }) query: PresignQuery,
    @Req() request: ChatRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PresignedUrlResponse> {
    const signed = await this.store.presign(
      this.ownerOf(request),
      query.sessionId as SessionId,
      attachmentId,
      query.disposition,
    );
    if (signed === undefined) {
      throw this.fail("attachment_not_found", HttpStatus.NOT_FOUND);
    }

    /** Guard: the body carries a bearer credential, so no cache may keep it. */
    response.setHeader("cache-control", "no-store");

    return signed;
  }

  @Delete("files/:attachmentId")
  async remove(
    @Query("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
    @Param("attachmentId", { schema: attachmentIdSchema }) attachmentId: string,
    @Req() request: ChatRequest,
  ): Promise<AttachmentListResponse> {
    const owner = this.ownerOf(request);
    const removed = await this.store.remove(owner, sessionId, attachmentId);
    if (!removed) {
      throw this.fail("attachment_not_found", HttpStatus.NOT_FOUND);
    }

    return { attachments: await this.store.list(owner, sessionId) };
  }

  private ownerOf(request: ChatRequest): OwnerId {
    const owner = request.owner;
    if (owner === undefined) {
      throw this.fail("owner_missing", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return owner;
  }

  private localeOf(
    request: RequestWithLocale,
  ): NonNullable<RequestWithLocale["locale"]> {
    return request.locale ?? this.i18n.defaultLocale;
  }

  private fail(code: string, status: HttpStatus): HttpException {
    const body: ApiError = {
      code,
      message: this.i18n.t(`chat:errors.${code}`),
    };

    return new HttpException(body, status);
  }
}
