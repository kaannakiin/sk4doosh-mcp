import type { SessionId } from "@chat/contracts/chat/session";
import { sandboxPathSchema } from "@chat/contracts/attachment/object-key";
import type { AttachmentRow } from "@chat/db";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

import type { AppConfig, CacheConfig } from "../config/configuration.ts";
import { ObjectStorageService } from "./object-storage.service.ts";
import {
  isContained,
  readableRootFor,
  sessionCacheRootFor,
  stagingRootFor,
} from "./session-root.ts";

interface CacheEntry {
  readonly session: SessionId;
  readonly path: string;
  readonly bytes: number;
}

export class MaterializationError extends Error {
  constructor(readonly reason: "corrupt" | "cache_full" | "path_escape") {
    super(reason);
    this.name = "MaterializationError";
  }
}

@Injectable()
export class SandboxCacheService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SandboxCacheService.name);

  private readonly cache: CacheConfig;

  private readonly inflight = new Map<string, Promise<string>>();

  /** Insertion order is the LRU order; a touch deletes and re-sets the key. */
  private readonly entries = new Map<string, CacheEntry>();

  private readonly pinned = new Set<SessionId>();

  private readonly lastUsedAt = new Map<SessionId, number>();

  private used = 0;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly objects: ObjectStorageService,
  ) {
    this.cache = config.get("cache", { infer: true });
  }

  /**
   * Guard: the whole cache root is removed at boot. The byte accounting lives in
   * this process only, so a directory left by a previous run is bytes the budget
   * can never reclaim, and a `.staging` temp abandoned by a SIGKILL is a file
   * nothing will ever own. Lazy materialization makes a cold cache free, which is
   * exactly what that decision bought. The root must therefore be process-local:
   * on a shared volume this deletes a peer's live cache.
   */
  async onApplicationBootstrap(): Promise<void> {
    const root = resolve(this.cache.root);
    if (
      root === sep ||
      root === resolve(tmpdir()) ||
      root.split(sep).length < 3
    ) {
      throw new Error(`refusing to use ${root} as a cache root`);
    }
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
  }

  async onModuleDestroy(): Promise<void> {
    this.inflight.clear();
  }

  /**
   * Creates the directory a reader is spawned against, and leaves it empty.
   *
   * Guard: the directory must exist before the reader process starts because the
   * root is pinned at spawn. The bytes need not: the pinned handle is a directory
   * capability and every read resolves against it per call, so a file written
   * afterwards is fully visible. That is what makes "eager directory, lazy bytes"
   * work at all.
   */
  async readableRootFor(session: SessionId): Promise<string> {
    const root = readableRootFor(this.cache.root, session);
    await mkdir(root, { recursive: true });
    this.touch(session);

    return root;
  }

  /**
   * Guarantees the bytes behind a manifest path are on disk.
   *
   * @returns the absolute path a reader tool can open
   */
  async ensure(session: SessionId, record: AttachmentRow): Promise<string> {
    if (record.sandboxPath === null) {
      throw new MaterializationError("path_escape");
    }

    const root = await this.readableRootFor(session);
    const target = join(root, sandboxPathSchema.parse(record.sandboxPath));
    if (!isContained(root, target)) {
      throw new MaterializationError("path_escape");
    }

    const key = `${session}:${record.id}`;
    const cached = await this.hit(key, target, record.bytes);
    if (cached) {
      return target;
    }

    const existing = this.inflight.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const pending = this.materialize(session, record, target)
      .then(() => target)
      .finally(() => {
        /**
         * Guard: the key is dropped on settle, not only on rejection. A rejected
         * promise left behind is permanently poisonous — every later call awaits
         * the same failure, so one transient outage bricks that attachment for the
         * life of the process. Dropping a resolved one too keeps the `stat` fast
         * path authoritative after a reap.
         */
        if (this.inflight.get(key) === pending) {
          this.inflight.delete(key);
        }
      });
    this.inflight.set(key, pending);

    return pending;
  }

  /** Called by the reader session service while a client holds this root open. */
  pin(session: SessionId): void {
    this.pinned.add(session);
  }

  unpin(session: SessionId): void {
    this.pinned.delete(session);
  }

  touch(session: SessionId): void {
    this.lastUsedAt.set(session, Date.now());
  }

  idleSessions(idleTtlMs: number): SessionId[] {
    const cutoff = Date.now() - idleTtlMs;

    return [...this.lastUsedAt.entries()]
      .filter(([, at]) => at < cutoff)
      .map(([session]) => session);
  }

  /**
   * Drops a session's cached files. The rows and the objects are untouched.
   */
  async evictSession(session: SessionId): Promise<void> {
    for (const [key, entry] of [...this.entries.entries()]) {
      if (entry.session === session) {
        this.forget(key, entry);
      }
    }
    this.lastUsedAt.delete(session);
    await rm(sessionCacheRootFor(this.cache.root, session), {
      recursive: true,
      force: true,
    });
  }

  async evict(session: SessionId, attachmentId: string): Promise<void> {
    const key = `${session}:${attachmentId}`;
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return;
    }
    this.forget(key, entry);
    await rm(entry.path, { force: true });
  }

  private async hit(
    key: string,
    target: string,
    bytes: number,
  ): Promise<boolean> {
    /**
     * Guard: a local `stat` answers first and the checksum is not recomputed. That
     * is not an optimisation — it is the mechanism that keeps a session answerable
     * while the object store is unreachable. Re-verifying here would also hash a
     * 25 MB workbook on each of a turn's eight tool calls.
     */
    try {
      const found = await stat(target);
      if (found.size === bytes) {
        const entry = this.entries.get(key);
        if (entry !== undefined) {
          this.entries.delete(key);
          this.entries.set(key, entry);
        }

        return true;
      }
    } catch {
      return false;
    }

    return false;
  }

  private async materialize(
    session: SessionId,
    record: AttachmentRow,
    target: string,
  ): Promise<void> {
    await this.makeRoom(record.bytes);

    const staging = stagingRootFor(this.cache.root, session);
    await mkdir(staging, { recursive: true });
    const temp = join(staging, `${record.id}.part`);

    const digest = createHash("sha256");
    let seen = 0;
    try {
      const source = await this.objects.read(record.objectKey);
      source.on("data", (chunk: Buffer) => {
        digest.update(chunk);
        seen += chunk.length;
      });
      await pipeline(source, createWriteStream(temp));

      /**
       * Guard: both length and digest are checked, and before the rename — never
       * after. A rename-then-verify design leaves a window in which a concurrent
       * tool call reads unverified bytes, and the model reports whatever they say
       * with the full confidence of a tool result.
       */
      if (seen !== record.bytes || digest.digest("hex") !== record.checksum) {
        await rm(temp, { force: true });
        this.logger.error(
          `checksum or length mismatch for ${record.objectKey}: expected ${String(record.bytes)} bytes`,
        );
        throw new MaterializationError("corrupt");
      }

      await rename(temp, target);
      this.remember(`${session}:${record.id}`, {
        session,
        path: target,
        bytes: record.bytes,
      });
    } catch (cause) {
      await rm(temp, { force: true });
      if (cause instanceof MaterializationError) {
        throw cause;
      }
      this.logger.error(`materialization failed: ${describe(cause)}`);
      throw new MaterializationError("corrupt");
    }
  }

  /**
   * Guard: the budget spans every session, not one. Lazy materialization plus
   * indefinite retention makes this the only bounded resource — one visitor
   * reopening fifty old conversations materializes fifty working sets. When room
   * cannot be made the tool call is refused rather than written anyway: a failed
   * call costs one turn, a full disk takes the api down.
   */
  private async makeRoom(bytes: number): Promise<void> {
    if (bytes > this.cache.maxBytes) {
      throw new MaterializationError("cache_full");
    }

    for (const [key, entry] of this.entries) {
      if (this.used + bytes <= this.cache.maxBytes) {
        break;
      }
      if (this.pinned.has(entry.session)) {
        continue;
      }
      this.forget(key, entry);
      await rm(entry.path, { force: true });
    }

    if (this.used + bytes > this.cache.maxBytes) {
      throw new MaterializationError("cache_full");
    }
  }

  private remember(key: string, entry: CacheEntry): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.used -= previous.bytes;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.used += entry.bytes;
  }

  private forget(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.used = Math.max(0, this.used - entry.bytes);
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
