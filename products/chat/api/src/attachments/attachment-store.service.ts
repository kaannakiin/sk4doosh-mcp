import type { Attachment } from "@chat/contracts/attachment/attachment";
import {
  EXTENSION_BY_MEDIA_TYPE,
  READER_FAMILY_BY_MEDIA_TYPE,
  type ReaderFamily,
} from "@chat/contracts/attachment/media-type";
import type { UploadResponse } from "@chat/contracts/attachment/upload";
import type { SessionId } from "@chat/contracts/chat/session";
import type { ApiError } from "@chat/contracts/http/error";
import {
  HttpException,
  HttpStatus,
  Injectable,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AppConfig, UploadConfig } from "../config/configuration.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { detectMediaType, type DetectionFailure } from "./detect-media-type.ts";
import {
  isContained,
  sandboxFileName,
  sessionRootFor,
} from "./session-root.ts";

export interface UploadedFile {
  readonly originalname: string;
  readonly size: number;
  readonly buffer: Buffer;
}

interface SessionEntry {
  readonly root: string;
  readonly attachments: Map<string, Attachment>;
  bytes: number;
  lastUsedAt: number;
}

const SWEEP_CEILING_MS = 60_000;

@Injectable()
export class AttachmentStoreService implements OnModuleDestroy {
  private readonly sessions = new Map<SessionId, SessionEntry>();

  private readonly uploads: UploadConfig;

  private readonly sweeper: NodeJS.Timeout;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly i18n: I18nService,
  ) {
    this.uploads = config.get("uploads", { infer: true });
    this.sweeper = setInterval(
      () => void this.sweep(),
      Math.min(this.uploads.ttlMs, SWEEP_CEILING_MS),
    );
    this.sweeper.unref();
  }

  rootFor(session: SessionId): string {
    return this.entry(session).root;
  }

  list(session: SessionId): Attachment[] {
    return [...this.entry(session).attachments.values()];
  }

  familiesFor(session: SessionId): ReadonlySet<ReaderFamily> {
    return new Set(this.list(session).map((attachment) => attachment.family));
  }

  async put(session: SessionId, file: UploadedFile): Promise<UploadResponse> {
    const detection = detectMediaType(file.originalname, file.buffer);
    if (!detection.ok) {
      throw this.reject(detection.reason, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    const entry = this.entry(session);
    if (entry.attachments.size >= this.uploads.maxFiles) {
      throw this.reject("too_many_files", HttpStatus.CONFLICT);
    }
    if (entry.bytes + file.size > this.uploads.maxBytes) {
      throw this.reject(
        "session_budget_exceeded",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const id = randomUUID();
    const { mediaType } = detection;
    const sandboxPath = sandboxFileName(
      file.originalname,
      id,
      EXTENSION_BY_MEDIA_TYPE[mediaType],
    );

    await mkdir(entry.root, { recursive: true });
    await writeFile(join(entry.root, sandboxPath), file.buffer, { flag: "wx" });

    const attachment: Attachment = {
      id,
      filename: file.originalname,
      mediaType,
      family: READER_FAMILY_BY_MEDIA_TYPE[mediaType],
      sandboxPath,
      bytes: file.size,
      expiresAt: new Date(Date.now() + this.uploads.ttlMs).toISOString(),
    };

    entry.attachments.set(id, attachment);
    entry.bytes += file.size;
    entry.lastUsedAt = Date.now();

    return {
      attachment,
      remainingFiles: this.uploads.maxFiles - entry.attachments.size,
      remainingBytes: this.uploads.maxBytes - entry.bytes,
    };
  }

  async remove(session: SessionId, attachmentId: string): Promise<boolean> {
    const entry = this.sessions.get(session);
    const attachment = entry?.attachments.get(attachmentId);
    if (entry === undefined || attachment === undefined) {
      return false;
    }

    await this.unlink(entry, attachment);

    return true;
  }

  touch(session: SessionId): void {
    this.entry(session).lastUsedAt = Date.now();
  }

  async dispose(session: SessionId): Promise<void> {
    const entry = this.sessions.get(session);
    if (entry === undefined) {
      return;
    }

    this.sessions.delete(session);
    await rm(entry.root, { recursive: true, force: true });
  }

  idleSessions(idleTtlMs: number): SessionId[] {
    const cutoff = Date.now() - idleTtlMs;

    return [...this.sessions.entries()]
      .filter(([, entry]) => entry.lastUsedAt < cutoff)
      .map(([session]) => session);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.sessions.keys()].map((id) => this.dispose(id)));
  }

  private entry(session: SessionId): SessionEntry {
    const existing = this.sessions.get(session);
    if (existing !== undefined) {
      return existing;
    }

    const created: SessionEntry = {
      root: sessionRootFor(this.uploads.root, session),
      attachments: new Map(),
      bytes: 0,
      lastUsedAt: Date.now(),
    };
    this.sessions.set(session, created);

    return created;
  }

  private async unlink(
    entry: SessionEntry,
    attachment: Attachment,
  ): Promise<void> {
    const target = join(entry.root, attachment.sandboxPath);
    if (!isContained(entry.root, target)) {
      throw this.reject("path_escape", HttpStatus.INTERNAL_SERVER_ERROR);
    }

    entry.attachments.delete(attachment.id);
    entry.bytes = Math.max(0, entry.bytes - attachment.bytes);
    await rm(target, { force: true });
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const entry of this.sessions.values()) {
      for (const attachment of entry.attachments.values()) {
        if (Date.parse(attachment.expiresAt) <= now) {
          await this.unlink(entry, attachment);
        }
      }
    }
  }

  private reject(
    reason:
      | DetectionFailure
      | "too_many_files"
      | "session_budget_exceeded"
      | "path_escape",
    status: HttpStatus,
  ): HttpException {
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
