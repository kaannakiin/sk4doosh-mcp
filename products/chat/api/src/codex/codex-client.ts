import { Codex, type Thread } from "@openai/codex-sdk";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig, CodexConfig } from "../config/configuration.ts";

export interface ThreadRequest {
  readonly workingDirectory: string;
  readonly threadId?: string;
}

@Injectable()
export class CodexClientService {
  private readonly settings: CodexConfig;

  private client: Codex | undefined;

  constructor(config: ConfigService<AppConfig, true>) {
    this.settings = config.get("codex", { infer: true });
  }

  get configured(): boolean {
    return this.settings.home !== undefined;
  }

  get timeoutMs(): number {
    return this.settings.timeoutMs;
  }

  /**
   * Starts or resumes the agent thread for one conversation.
   *
   * Guard: `approvalPolicy` is `never` because the TypeScript sdk exposes no
   * callback the agent's own approval prompt could be answered through — leaving
   * it on would hang the subprocess on a question nothing can reach. What makes
   * that safe is the pair below it: the agent may write inside its working
   * directory and nowhere else, and it has no network. The reader's consent is
   * collected once, by this product's own approval gate, before any of this runs.
   */
  threadFor({ workingDirectory, threadId }: ThreadRequest): Thread {
    const options = {
      model: this.settings.model,
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    } as const;

    const codex = this.codex();

    return threadId === undefined
      ? codex.startThread(options)
      : codex.resumeThread(threadId, options);
  }

  /**
   * Guard: `env` is an allowlist, not an addition. The sdk stops inheriting
   * `process.env` the moment this is passed, which is the point — a credential
   * the server holds for its own use cannot reach the agent by accident. The
   * cost is that `PATH` has to be named here, or the cli cannot find the tools
   * it shells out to.
   *
   * Guard: `apiKey` is never passed. Which credential the agent runs under is
   * decided entirely by what `CODEX_HOME` holds, so changing that decision is a
   * deployment change and never a code change.
   */
  private codex(): Codex {
    this.client ??= new Codex({
      codexPathOverride: this.settings.binary,
      baseUrl: this.settings.baseUrl,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: this.settings.home ?? "",
        CODEX_HOME: this.settings.home ?? "",
      },
      config: { sandbox_workspace_write: { network_access: false } },
    });

    return this.client;
  }
}
