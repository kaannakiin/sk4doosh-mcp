import type { SessionId } from "@chat/contracts/chat/session";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

import { SandboxCacheService } from "../attachments/sandbox-cache.service.ts";
import { errorMessage } from "../common/utils/error.utils.ts";
import type { AppConfig, CodexConfig } from "../config/configuration.ts";
import { DELEGATION_INSTRUCTIONS } from "./delegation-instructions.ts";

const SWEEP_INTERVAL_MS = 60_000;

const IDLE_TTL_MS = 30 * 60 * 1000;

export interface CodexWorkspace {
  readonly directory: string;
  readonly copied: readonly string[];
}

/**
 * Guard: refuses a resolved path that escapes `root`. `filePath` arrives from a
 * tool call the model composed, so it is untrusted even though the attachment
 * lookup that precedes it is scoped to the session.
 */
function isContained(root: string, candidate: string): boolean {
  const base = resolve(root);
  const target = resolve(candidate);

  return target === base || target.startsWith(`${base}${sep}`);
}

/**
 * The directory one conversation's agent runs in.
 *
 * Guard: this root is never `CHAT_CACHE_ROOT`. The attachment cache is emptied
 * at boot and evicted across sessions under byte pressure; a working directory
 * living under it would be deleted mid-run by an unrelated upload, and the agent
 * would report a failure nobody could trace back to the upload that caused it.
 */
@Injectable()
export class CodexWorkspaceService implements OnModuleDestroy {
  private readonly logger = new Logger(CodexWorkspaceService.name);

  private readonly touched = new Map<SessionId, number>();

  private readonly releasing: ((session: SessionId) => Promise<void>)[] = [];

  private readonly settings: CodexConfig;

  private readonly sweeper: NodeJS.Timeout;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly cache: SandboxCacheService,
  ) {
    this.settings = config.get("codex", { infer: true });
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  /**
   * Prepares the conversation's working directory and stages the attachments the
   * tool call named.
   *
   * Guard: a file the model asked for but the session does not hold is skipped
   * rather than raised. The agent is told which files arrived, so a miss becomes
   * something it can work around instead of a turn that produces no result.
   *
   * @param staged attachment paths as they appear in the attachment manifest
   * @returns the directory to run in and the base names that were actually staged
   */
  async prepare(
    session: SessionId,
    staged: readonly string[],
  ): Promise<CodexWorkspace> {
    const directory = this.directoryFor(session);
    const files = join(directory, "files");
    await mkdir(files, { recursive: true });
    this.touched.set(session, Date.now());
    if (this.settings.localWorker !== undefined) {
      await writeFile(join(directory, "AGENTS.md"), DELEGATION_INSTRUCTIONS);
    }

    if (staged.length === 0) {
      return { directory, copied: [] };
    }

    const readable = await this.cache.readableRootFor(session);
    const copied: string[] = [];
    for (const path of staged) {
      const source = join(readable, path);
      if (!isContained(readable, source)) {
        continue;
      }

      const name = basename(path);
      try {
        await copyFile(source, join(files, name));
        copied.push(name);
      } catch (cause) {
        this.logger.warn(
          `codex could not stage ${name}: ${errorMessage(cause)}`,
        );
      }
    }

    return { directory, copied };
  }

  /**
   * Guard: a listener runs before the directory is removed, and that order is
   * load bearing for the same reason `ReaderSessionService.sweep` gives — a
   * server still holding a file in the workspace keeps its inode alive while the
   * next call by name fails.
   *
   * @param listener what must let go of a conversation's workspace first
   */
  onRelease(listener: (session: SessionId) => Promise<void>): void {
    this.releasing.push(listener);
  }

  async release(session: SessionId): Promise<void> {
    this.touched.delete(session);
    for (const listener of this.releasing) {
      await listener(session);
    }
    await rm(this.directoryFor(session), { recursive: true, force: true });
  }

  /**
   * Guard: eviction runs against the oldest directories rather than the newest,
   * and never against the conversation that is asking. A ceiling that could
   * delete the workspace of the run requesting it would fail that run to make
   * room for itself.
   */
  async evictOverflow(active: SessionId): Promise<void> {
    this.touched.set(active, Date.now());
    if (this.touched.size <= this.settings.maxWorkspaces) {
      return;
    }

    const oldest = [...this.touched.entries()]
      .filter(([session]) => session !== active)
      .sort(([, left], [, right]) => left - right)
      .slice(0, this.touched.size - this.settings.maxWorkspaces);

    for (const [session] of oldest) {
      await this.release(session);
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    const sessions = [...this.touched.keys()];
    this.touched.clear();
    await Promise.all(
      sessions.map((session) =>
        rm(this.directoryFor(session), { recursive: true, force: true }),
      ),
    );
  }

  private directoryFor(session: SessionId): string {
    return join(this.settings.root, session);
  }

  private async sweep(): Promise<void> {
    const cutoff = Date.now() - IDLE_TTL_MS;
    for (const [session, at] of [...this.touched.entries()]) {
      if (at <= cutoff) {
        await this.release(session);
      }
    }
  }
}
