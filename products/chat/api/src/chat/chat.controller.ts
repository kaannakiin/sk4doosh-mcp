import { attachmentIdSchema } from "@chat/contracts/attachment/attachment";
import type {
  AttachmentListResponse,
  UploadResponse,
} from "@chat/contracts/attachment/upload";
import { sessionIdSchema, type SessionId } from "@chat/contracts/chat/session";
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
  HttpException,
  HttpStatus,
  Param,
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
import { ReaderSessionService } from "../mcp/reader-session.service.ts";
import { ChatService } from "./chat.service.ts";

@Controller("chat")
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly store: AttachmentStoreService,
    private readonly readers: ReaderSessionService,
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
    @Req() request: RequestWithLocale,
    @Res() response: Response,
  ): Promise<void> {
    await this.chat.stream(body, response, this.localeOf(request));
  }

  @Post("files")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @Query("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
    @UploadedFile() file: StoredUpload | undefined,
  ): Promise<UploadResponse> {
    if (file === undefined) {
      throw this.fail("file_missing", HttpStatus.BAD_REQUEST);
    }

    return this.store.put(sessionId, file);
  }

  @Get("files")
  list(
    @Query("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
  ): AttachmentListResponse {
    return { attachments: this.store.list(sessionId) };
  }

  @Delete("files/:attachmentId")
  async remove(
    @Query("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
    @Param("attachmentId", { schema: attachmentIdSchema }) attachmentId: string,
  ): Promise<AttachmentListResponse> {
    const removed = await this.store.remove(sessionId, attachmentId);
    if (!removed) {
      throw this.fail("attachment_not_found", HttpStatus.NOT_FOUND);
    }

    return { attachments: this.store.list(sessionId) };
  }

  @Delete("session")
  async end(
    @Query("sessionId", { schema: sessionIdSchema }) sessionId: SessionId,
  ): Promise<void> {
    await this.readers.release(sessionId);
    await this.store.dispose(sessionId);
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
