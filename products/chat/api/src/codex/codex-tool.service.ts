import type { Locale } from "@chat/contracts/common/locale";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Readiness } from "@chat/contracts/http/health";
import { codexTaskInputSchema } from "@chat/contracts/tools/codex/task";
import type {
  CodexTaskInput,
  CodexTaskOutput,
} from "@chat/contracts/tools/codex/task";
import { Injectable } from "@nestjs/common";
import { tool, type ToolSet } from "ai";

import type { UserId } from "../db/ids.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { CodexClientService } from "./codex-client.ts";
import { CodexRunnerService } from "./codex-runner.service.ts";
import { CodexWorkspaceService } from "./codex-workspace.service.ts";

@Injectable()
export class CodexToolService {
  constructor(
    private readonly client: CodexClientService,
    private readonly runner: CodexRunnerService,
    private readonly workspaces: CodexWorkspaceService,
    private readonly i18n: I18nService,
  ) {}

  status(): Readiness {
    return this.client.configured ? "ready" : "unconfigured";
  }

  /**
   * The coding agent half of a turn's tool surface.
   *
   * Guard: an unconfigured deployment offers nothing rather than offering a tool
   * that always fails. `CHAT_CODEX_HOME` is what carries the agent's credentials,
   * so without it every call would end the same way, and a tool the model can see
   * is a tool it will spend a step on.
   */
  toolsFor(userId: UserId, session: SessionId, locale: Locale): ToolSet {
    if (!this.client.configured) {
      return {};
    }

    return {
      codex_task: tool({
        description: this.i18n.t("chat:tools.codex.description", {}, locale),
        inputSchema: codexTaskInputSchema,
        execute: (input: CodexTaskInput, { abortSignal }) =>
          this.execute(userId, session, input, abortSignal),
      }),
    };
  }

  /**
   * The per-tool timeout entry this turn needs, keyed the way the sdk keys them.
   *
   * Guard: the key is `` `${toolName}Ms` ``, and it is derived from the tool set
   * rather than written out, so a tool renamed in the catalog cannot leave a
   * stale budget behind that silently stops applying.
   */
  toolBudget(tools: ToolSet): Record<string, number> | undefined {
    const names = Object.keys(tools);
    if (names.length === 0) {
      return undefined;
    }

    return Object.fromEntries(
      names.map((name) => [`${name}Ms`, this.client.timeoutMs]),
    );
  }

  private async *execute(
    userId: UserId,
    session: SessionId,
    input: CodexTaskInput,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<CodexTaskOutput> {
    await this.workspaces.evictOverflow(session);

    let workspace;
    try {
      workspace = await this.workspaces.prepare(session, input.files ?? []);
    } catch {
      yield { phase: "failed", error: "codex_workspace_unavailable" };

      return;
    }

    yield* this.runner.run({
      userId,
      session,
      workingDirectory: workspace.directory,
      prompt: promptFor(input, workspace.copied),
      signal,
    });
  }
}

/**
 * Guard: the staged file names are stated to the agent rather than left for it to
 * discover. A file the reader attached but this run could not stage is simply
 * absent from the directory, and an agent that assumes otherwise spends its turn
 * looking for it.
 */
function promptFor(input: CodexTaskInput, copied: readonly string[]): string {
  if (copied.length === 0) {
    return input.instruction;
  }

  const listed = copied.map((name) => `- files/${name}`).join("\n");

  return `${input.instruction}\n\nAvailable files in the working directory:\n${listed}`;
}
