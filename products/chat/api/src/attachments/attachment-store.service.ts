import type { Attachment } from "@chat/contracts/attachment/attachment";
import { UPLOAD_CONCURRENCY_DEFAULT } from "@chat/contracts/attachment/limits";
import {
  EXTENSION_BY_MEDIA_TYPE,
  READER_FAMILY_BY_MEDIA_TYPE,
  isInlineMediaType,
  isSupportedMediaType,
  type ReaderFamily,
  type SupportedMediaType,
} from "@chat/contracts/attachment/media-type";
import { objectKeyFor } from "@chat/contracts/attachment/object-key";
import type {
  PresignDisposition,
  PresignedUrlResponse,
} from "@chat/contracts/attachment/presign";
import type { UploadResponse } from "@chat/contracts/attachment/upload";
import type { SessionId } from "@chat/contracts/chat/session";
import type { ApiError } from "@chat/contracts/http/error";
import {
  createAttachment,
  familiesFor,
  findAttachment,
  findBySandboxPath,
  listAttachments,
  softDeleteAttachment,
  type AttachmentRow,
} from "@chat/db";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";

import type { AppConfig, UploadConfig } from "../config/configuration.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { DbService } from "../db/db.service.ts";
import type { OwnerId } from "../owner/owner-id.ts";
import { detectMediaType, type DetectionFailure } from "./detect-media-type.ts";
import { ObjectStorageService } from "./object-storage.service.ts";
import { SandboxCacheService } from "./sandbox-cache.service.ts";
import { sandboxFileName } from "./session-root.ts";

export interface UploadedFile {
  readonly originalname: string;
  readonly size: number;
  readonly buffer: Buffer;
}

type Refusal =
  | DetectionFailure
  | "too_many_files"
  | "session_budget_exceeded"
  | "session_not_found"
  | "storage_unavailable"
  | "not_previewable"
  | "path_escape";

@Injectable()
export class AttachmentStoreService {
  private readonly logger = new Logger(AttachmentStoreService.name);

  private readonly uploads: UploadConfig;

  private inflightUploads = 0;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly db: DbService,
    private readonly objects: ObjectStorageService,
    private readonly cache: SandboxCacheService,
    private readonly i18n: I18nService,
  ) {
    this.uploads = config.get("uploads", { infer: true });
  }

  async list(owner: OwnerId, session: SessionId): Promise<Attachment[]> {
    return (await listAttachments(this.db.client, owner, session)).map(
      toPublic,
    );
  }

  async familiesFor(
    owner: OwnerId,
    session: SessionId,
  ): Promise<ReadonlySet<ReaderFamily>> {
    return new Set(await familiesFor(this.db.client, owner, session));
  }

  /**
   * Stores an upload: proven, hashed, written to the object store, then recorded.
   *
   * Guard: the object is written before the row, and that order is the whole
   * design. A failed insert after a successful put leaves bytes nothing
   * references — invisible, never listed, never presigned, reclaimable by a
   * sweeper. The reverse leaves a row naming bytes that do not exist, which the
   * manifest offers the model as a readable file and the browser renders as a
   * broken image. One orphan is litter, the other is poison.
   */
  async put(
    owner: OwnerId,
    session: SessionId,
    file: UploadedFile,
  ): Promise<UploadResponse> {
    if (this.inflightUploads >= UPLOAD_CONCURRENCY_DEFAULT) {
      throw this.reject("storage_unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }
    this.inflightUploads += 1;
    try {
      return await this.store(owner, session, file);
    } finally {
      this.inflightUploads -= 1;
    }
  }

  async remove(
    owner: OwnerId,
    session: SessionId,
    attachmentId: string,
  ): Promise<boolean> {
    const removed = await softDeleteAttachment(
      this.db.client,
      owner,
      session,
      attachmentId,
    );
    if (removed === undefined) {
      return false;
    }

    await this.cache.evict(session, attachmentId);
    try {
      await this.objects.remove(removed.objectKey);
    } catch (cause) {
      this.logger.error(
        `orphan object ${removed.objectKey}: ${describe(cause)}`,
      );
    }

    return true;
  }

  /**
   * Resolves the path a reader tool named and puts its bytes on disk.
   *
   * Guard: the lookup is by `sandbox_path` and scoped to this owner's session, so
   * a model that hallucinates a name or replays another conversation's file gets
   * a miss here rather than a read. Cross-session access is refused twice — once
   * by this query, once by the reader's own containment check.
   */
  async resolveForTool(
    owner: OwnerId,
    session: SessionId,
    filePath: string,
  ): Promise<void> {
    const record = await findBySandboxPath(
      this.db.client,
      owner,
      session,
      filePath,
    );
    if (record === undefined) {
      return;
    }

    await this.cache.ensure(session, record);
  }

  async presign(
    owner: OwnerId,
    session: SessionId,
    attachmentId: string,
    asked: PresignDisposition,
  ): Promise<PresignedUrlResponse | undefined> {
    const record = await findAttachment(
      this.db.client,
      owner,
      session,
      attachmentId,
    );
    if (record === undefined) {
      return undefined;
    }

    const mediaType = record.mediaType;
    if (!isSupportedMediaType(mediaType)) {
      throw this.reject("not_previewable", HttpStatus.BAD_REQUEST);
    }

    /**
     * Guard: a caller may ask for `inline`, never impose it. The decision is read
     * from the stored media type, so markup-shaped content can never be rendered
     * in the storage origin — and asking for it is an error rather than a silent
     * downgrade, because a interface bug should be loud.
     */
    if (asked === "inline" && !isInlineMediaType(mediaType)) {
      throw this.reject("not_previewable", HttpStatus.BAD_REQUEST);
    }

    const signed = await this.objects.presign(
      record.objectKey,
      mediaType,
      asked,
      record.filename,
    );

    return { ...signed, disposition: asked, mediaType };
  }

  private async store(
    owner: OwnerId,
    session: SessionId,
    file: UploadedFile,
  ): Promise<UploadResponse> {
    const detection = detectMediaType(file.originalname, file.buffer);
    if (!detection.ok) {
      throw this.reject(detection.reason, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    const { mediaType } = detection;
    const attachmentId = randomUUID();
    const storedName = sandboxFileName(
      file.originalname,
      attachmentId,
      EXTENSION_BY_MEDIA_TYPE[mediaType],
    );
    const family = READER_FAMILY_BY_MEDIA_TYPE[mediaType];
    const objectKey = objectKeyFor(session, attachmentId, storedName);
    const checksum = createHash("sha256").update(file.buffer).digest("hex");

    try {
      await this.objects.put(objectKey, file.buffer, mediaType, {
        "x-amz-meta-session": session,
        "x-amz-meta-attachment": attachmentId,
        "x-amz-meta-sha256": checksum,
        /**
         * Guard: `x-amz-meta-*` values are http header values and must be ascii. A
         * Turkish filename makes the put fail with an opaque error, so the name is
         * percent-encoded here and decoded by whoever reads it back.
         */
        "x-amz-meta-filename": encodeURIComponent(file.originalname),
      });
    } catch (cause) {
      this.logger.error(`object store write failed: ${describe(cause)}`);
      throw this.reject("storage_unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }

    const outcome = await createAttachment(this.db.client, {
      ownerId: owner,
      sessionId: session,
      attachmentId,
      filename: file.originalname,
      mediaType,
      family,
      sandboxPath: family === null ? null : storedName,
      objectKey,
      bytes: file.size,
      checksum,
      maxFiles: this.uploads.maxFiles,
      maxBytes: this.uploads.maxBytes,
    }).catch((cause: unknown) => {
      this.logger.error(`attachment insert failed: ${describe(cause)}`);

      return { ok: false, reason: "session_not_found" } as const;
    });

    if (!outcome.ok) {
      await this.objects
        .remove(objectKey)
        .catch((cause: unknown) =>
          this.logger.error(`orphan object ${objectKey}: ${describe(cause)}`),
        );
      throw this.reject(outcome.reason, statusFor(outcome.reason));
    }

    return {
      attachment: toPublic(outcome.row),
      remainingFiles: this.uploads.maxFiles - outcome.usage.files,
      remainingBytes: this.uploads.maxBytes - outcome.usage.bytes,
    };
  }

  private reject(reason: Refusal, status: HttpStatus): HttpException {
    const body: ApiError = {
      code: reason,
      message: this.i18n.t(`chat:upload.${reason}`, {
        maxFiles: this.uploads.maxFiles,
        maxMegabytes: Math.floor(this.uploads.maxBytes / (1024 * 1024)),
      }),
    };

    return new HttpException(body, status);
  }
}

function statusFor(reason: Refusal): HttpStatus {
  if (reason === "too_many_files") {
    return HttpStatus.CONFLICT;
  }
  if (reason === "session_budget_exceeded") {
    return HttpStatus.PAYLOAD_TOO_LARGE;
  }

  return HttpStatus.NOT_FOUND;
}

function toPublic(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    mediaType: row.mediaType as SupportedMediaType,
    family: row.family,
    sandboxPath: row.sandboxPath,
    bytes: row.bytes,
    createdAt: row.createdAt.toISOString(),
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
