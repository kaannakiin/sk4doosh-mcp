import type { AgentSelection } from "@chat/contracts/agent/model";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { UIMessage, UIMessageStreamWriterWithOutcome } from "ai";
import { basename, join } from "node:path";

import { AttachmentStoreService } from "../attachments/attachment-store.service.ts";
import { ChatSessionRepository } from "../chat/chat-session.repository.ts";
import { AppServerService } from "../codex/app-server/app-server.service.ts";
import type { JsonRpcConnection } from "../codex/app-server/json-rpc.ts";
import { NotificationQueue } from "../codex/app-server/notification-queue.ts";
import type { AppServerNotification } from "../codex/app-server/protocol.ts";
import { CodexWorkspaceService } from "../codex/codex-workspace.service.ts";
import type { JsonValue } from "../codex/protocol/generated/serde_json/JsonValue.ts";
import type { TurnStatus } from "../codex/protocol/generated/v2/TurnStatus.ts";
import { errorMessage } from "../common/utils/error.utils.ts";
import { ToolApprovalGateService } from "../chat/tool-approval-gate.service.ts";
import type {
  AppConfig,
  CodexConfig,
  GatewayConfig,
  LlmConfig,
} from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";
import {
  GATEWAY_SERVER,
  GatewayServerService,
} from "../gateway/gateway-server.service.ts";
import type {
  GatewayCall,
  GatewayTurn,
  ToolDirectory,
} from "../gateway/gateway-turn.ts";
import { GrantRegistry } from "../gateway/grant-registry.ts";
import { ToolDirectoryService } from "../gateway/tool-directory.service.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import type { AgentUIMessage } from "./agent-message.ts";
import { ModelCatalogService } from "./model-catalog.service.ts";
import type { GatewayCalls } from "./agent-steps.ts";
import { TelemetryCollector } from "./telemetry-collector.ts";
import { threadConfigFor } from "./thread-config.ts";
import { historyBefore, lastUserText } from "./turn-input.ts";
import { TurnRenderer } from "./turn-renderer.ts";

const INTERRUPT_GRACE_MS = 5_000;

const GATEWAY_READY_MS = 10_000;

export interface AgentTurnRequest {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly messages: readonly UIMessage[];
  readonly selection: AgentSelection | null;
  readonly locale: Locale;
  readonly signal: AbortSignal;
}

interface OpenedThread {
  readonly threadId: string;
  readonly fresh: boolean;
}

interface DriveInput {
  readonly request: AgentTurnRequest;
  readonly writer: Writer;
  readonly opened: OpenedThread;
  readonly selection: AgentSelection;
  readonly startedAt: number;
  readonly copied: readonly string[];
  readonly calls: GatewayCalls;
}

type Writer = UIMessageStreamWriterWithOutcome<AgentUIMessage>;

function threadIdOf(notification: AppServerNotification): string | undefined {
  return "threadId" in notification.params
    ? (notification.params.threadId ?? undefined)
    : undefined;
}

function serversOf(directory: ToolDirectory): string {
  const counts = new Map<string, number>();
  for (const { server } of directory.values()) {
    counts.set(server, (counts.get(server) ?? 0) + 1);
  }

  return [...counts]
    .map(([server, count]) => `${server} (${count})`)
    .join(", ");
}

@Injectable()
export class AgentTurnService {
  private readonly logger = new Logger(AgentTurnService.name);

  private readonly codex: CodexConfig;

  private readonly llm: LlmConfig;

  private readonly gateway: GatewayConfig;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly appServer: AppServerService,
    private readonly catalog: ModelCatalogService,
    private readonly store: AttachmentStoreService,
    private readonly workspaces: CodexWorkspaceService,
    private readonly sessions: ChatSessionRepository,
    private readonly tools: ToolDirectoryService,
    private readonly approvals: ToolApprovalGateService,
    private readonly grants: GrantRegistry,
    private readonly gatewayServer: GatewayServerService,
    private readonly i18n: I18nService,
  ) {
    this.codex = config.get("codex", { infer: true });
    this.llm = config.get("llm", { infer: true });
    this.gateway = config.get("gateway", { infer: true });
  }

  get enabled(): boolean {
    return this.appServer.configured;
  }

  async run(request: AgentTurnRequest, writer: Writer): Promise<void> {
    const startedAt = Date.now();
    const deadline = AbortSignal.timeout(this.codex.timeoutMs);
    const stop = AbortSignal.any([request.signal, deadline]);

    const [selection, paths] = await Promise.all([
      this.catalog.effectiveFor(request.userId, request.selection),
      this.store.materializeReadable(request.userId, request.sessionId),
    ]);
    await this.workspaces.evictOverflow(request.sessionId);
    const workspace = await this.workspaces.prepare(request.sessionId, paths);
    const { directory, remote } = await this.tools.toolsFor({
      userId: request.userId,
      sessionId: request.sessionId,
      locale: request.locale,
      filesDir: join(workspace.directory, "files"),
      worker: {
        baseUrl: this.llm.baseUrl,
        model: selection.workerModel ?? this.llm.model,
      },
    });
    const approval = await this.approvals.gateFor(
      request.userId,
      request.sessionId,
      remote,
      request.locale,
    );

    const ended = new AbortController();
    const calls = new Map<string, GatewayCall>();
    const turn: GatewayTurn = {
      userId: request.userId,
      sessionId: request.sessionId,
      locale: request.locale,
      signal: AbortSignal.any([stop, ended.signal]),
      writer,
      directory,
      approval,
      allowed: new Set(),
      calls,
    };
    const grant = this.grants.open(turn, startedAt + this.codex.timeoutMs);

    let status: TurnStatus | undefined;
    try {
      const connection = await this.appServer.connection();
      const queue = new NotificationQueue(connection, stop);
      try {
        const opened = await this.openThread(
          connection,
          request,
          workspace.directory,
          threadConfigFor({
            gatewayUrl: this.gatewayServer.url,
            grant,
            approvalHoldMs: this.gateway.approvalHoldMs,
          }),
          serversOf(directory),
        );
        writer.write({ type: "start" });
        if (!(await this.gatewayReady(queue, opened.threadId))) {
          this.unavailable(writer, request.locale);

          return;
        }
        status = await this.drive(connection, queue, {
          request,
          writer,
          opened,
          selection,
          startedAt,
          copied: workspace.copied,
          calls,
        });
      } finally {
        queue.close();
      }
    } finally {
      ended.abort();
      this.grants.close(grant);
    }

    this.conclude(writer, status, request, deadline.aborted);
  }

  private async drive(
    connection: JsonRpcConnection,
    queue: NotificationQueue,
    input: DriveInput,
  ): Promise<TurnStatus | undefined> {
    const { request, writer, opened, selection } = input;
    const collector = new TelemetryCollector({
      mainThreadId: opened.threadId,
      model: selection.codexModel,
      effort: selection.effort,
      workerModel: selection.workerModel,
      startedAt: input.startedAt,
      calls: input.calls,
    });
    const renderer = new TurnRenderer(writer, opened.threadId, input.calls);
    renderer.telemetry(collector.snapshot());

    let turnId: string | undefined;
    let status: TurnStatus | undefined;
    try {
      const started = await connection.request("turn/start", {
        threadId: opened.threadId,
        input: [
          {
            type: "text",
            text: this.inputFor(request, opened.fresh, input.copied),
            text_elements: [],
          },
        ],
        model: selection.codexModel,
        effort: selection.effort,
      });
      turnId = started.turn.id;

      for (
        let notification = await queue.next();
        notification !== undefined;
        notification = await queue.next()
      ) {
        const threadId = threadIdOf(notification);
        if (threadId !== undefined && !collector.owns(threadId)) {
          continue;
        }
        if (collector.apply(notification, Date.now())) {
          renderer.telemetry(collector.snapshot());
        }
        renderer.render(notification);
        if (
          notification.method === "turn/completed" &&
          threadId === opened.threadId
        ) {
          status = notification.params.turn.status;
          if (notification.params.turn.error !== null) {
            this.logger.warn(
              `agent turn failed: ${notification.params.turn.error.message}`,
            );
          }
          break;
        }
      }
    } finally {
      renderer.closeAll();
      if (status === undefined && turnId !== undefined) {
        await this.interrupt(connection, opened.threadId, turnId);
      }
      collector.finish(Date.now());
      renderer.telemetry(collector.snapshot());
    }

    return status;
  }

  /**
   * Waits for the thread's gateway connection to come up.
   *
   * Guard: a turn does not start until codex reports the gateway `ready`.
   * Measured on 0.154: a gateway that refused the grant surfaced only as
   * `mcpServer/startupStatus/updated` with `failed`, and the turn that followed
   * ran with no tools and no error — the agent simply said the tools did not
   * exist, or went looking for the files with its shell.
   */
  private async gatewayReady(
    queue: NotificationQueue,
    threadId: string,
  ): Promise<boolean> {
    const timeout = new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), GATEWAY_READY_MS).unref(),
    );

    for (;;) {
      const notification = await Promise.race([queue.next(), timeout]);
      if (notification === undefined) {
        return false;
      }
      if (
        notification.method === "mcpServer/startupStatus/updated" &&
        notification.params.name === GATEWAY_SERVER &&
        notification.params.threadId === threadId
      ) {
        if (notification.params.status === "starting") {
          continue;
        }
        if (notification.params.status !== "ready") {
          this.logger.warn(
            `agent gateway did not start: ${notification.params.error ?? notification.params.status}`,
          );
        }

        return notification.params.status === "ready";
      }
    }
  }

  private unavailable(writer: Writer, locale: Locale): void {
    writer.write({
      type: "error",
      errorText: this.i18n.t("chat:agent.gateway_unavailable", {}, locale),
    });
    writer.setOutcome({ status: "failed" });
  }

  private conclude(
    writer: Writer,
    status: TurnStatus | undefined,
    request: AgentTurnRequest,
    timedOut: boolean,
  ): void {
    if (status === "completed") {
      writer.write({ type: "finish", finishReason: "stop" });
      writer.setOutcome({ status: "completed" });

      return;
    }

    if (request.signal.aborted) {
      writer.write({ type: "abort" });
      writer.setOutcome({ status: "aborted" });

      return;
    }

    writer.write({
      type: "error",
      errorText: this.i18n.t(
        timedOut
          ? "chat:tools.codex.errors.codex_timeout"
          : "chat:errors.stream_failed",
        {},
        request.locale,
      ),
    });
    writer.setOutcome({ status: "failed" });
  }

  /**
   * Guard: a stored thread that will not resume is replaced, not retried. The
   * id names a file under `$CODEX_HOME/sessions`, and a home that was reset or
   * moved leaves every conversation pointing at a thread that no longer exists —
   * failing those turns forever would be worse than starting them over with the
   * conversation replayed as history.
   */
  private async openThread(
    connection: JsonRpcConnection,
    request: AgentTurnRequest,
    cwd: string,
    config: { [key: string]: JsonValue },
    servers: string,
  ): Promise<OpenedThread> {
    const common = {
      cwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      config,
      developerInstructions: this.i18n.t(
        "chat:agent.instructions",
        {
          servers:
            servers === ""
              ? this.i18n.t("chat:gateway.no_servers", {}, request.locale)
              : servers,
        },
        request.locale,
      ),
    } as const;

    const known = await this.sessions.agentThreadFor(
      request.userId,
      request.sessionId,
    );
    if (known !== undefined) {
      /**
       * Guard: the thread is unsubscribed before it is resumed, every turn.
       * Measured on 0.154: resuming a thread the app-server still has loaded
       * ignores the new `config`, so the gateway kept receiving the previous
       * turn's grant — already closed — and the worker kept its previous model.
       * Unsubscribing first makes the resume load the thread again with this
       * turn's config; a thread that is not loaded answers without error.
       */
      await connection
        .request("thread/unsubscribe", { threadId: known })
        .catch(() => undefined);
      try {
        const resumed = await connection.request("thread/resume", {
          threadId: known,
          ...common,
        });

        return { threadId: resumed.thread.id, fresh: false };
      } catch (cause) {
        this.logger.warn(
          `agent thread ${known} did not resume: ${errorMessage(cause)}`,
        );
      }
    }

    const started = await connection.request("thread/start", common);
    await this.sessions.rememberAgentThread(
      request.userId,
      request.sessionId,
      started.thread.id,
    );

    return { threadId: started.thread.id, fresh: true };
  }

  private inputFor(
    request: AgentTurnRequest,
    fresh: boolean,
    copied: readonly string[],
  ): string {
    const sections: string[] = [];
    const history = fresh ? historyBefore(request.messages) : undefined;
    if (history !== undefined) {
      sections.push(
        this.i18n.t("chat:agent.history", { history }, request.locale),
      );
    }
    sections.push(lastUserText(request.messages));
    if (copied.length > 0) {
      sections.push(
        this.i18n.t(
          "chat:agent.files",
          { files: copied.map((name) => `- ${basename(name)}`).join("\n") },
          request.locale,
        ),
      );
    }

    return sections.join("\n\n");
  }

  private async interrupt(
    connection: JsonRpcConnection,
    threadId: string,
    turnId: string,
  ): Promise<void> {
    try {
      await Promise.race([
        connection.request("turn/interrupt", { threadId, turnId }),
        new Promise((resolve) => setTimeout(resolve, INTERRUPT_GRACE_MS)),
      ]);
    } catch (cause) {
      this.logger.warn(`agent turn interrupt failed: ${errorMessage(cause)}`);
    }
  }
}
