import type { ReaderFamily } from "@chat/contracts/attachment/media-type";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { sanitizeToolInputSchema } from "@chat/contracts/integration/tool-input-schema";
import { definitionOf } from "@chat/contracts/tools/tool-fingerprint";
import type { MCPClient } from "@ai-sdk/mcp";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolve } from "node:path";

import { AttachmentStoreService } from "../attachments/attachment-store.service.ts";
import { RemoteToolInvoker } from "../chat/remote-tool-invoker.ts";
import { searchableRemote, summarizeRemote } from "../chat/tool-search.ts";
import { errorMessage } from "../common/utils/error.utils.ts";
import type {
  AppConfig,
  CodexConfig,
  ReaderConfig,
} from "../config/configuration.ts";
import { IntegrationCatalogService } from "../connections/integration-catalog.service.ts";
import type { CatalogTool } from "../connections/integration-tool.repository.ts";
import { resolveToolNames } from "../connections/remote-tool-names.ts";
import type { UserId } from "../db/ids.ts";
import { readerToolsOf } from "../mcp/reader-catalog.ts";
import { readerCommandFor } from "../mcp/reader-command.ts";
import type {
  DirectoryEntry,
  GatewayResult,
  ToolDirectory,
  WorkerUsage,
} from "./gateway-turn.ts";
import { AgentServerPool, type ServerSpec } from "./server-pool.ts";
import { WorkerLanes } from "./worker-lane.ts";

export const WORKER_SERVER = "local";

const WORKER_TOOLS: ReadonlySet<string> = new Set(["local_task", "local_map"]);

const READER_VARIANT = "files";

export interface DirectoryRequest {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly locale: Locale;
  readonly filesDir: string;
  readonly worker: { readonly baseUrl: string; readonly model: string };
}

type CallResult = Awaited<ReturnType<MCPClient["callTool"]>>;

export interface TurnTools {
  readonly directory: ToolDirectory;
  readonly remote: ReadonlyMap<string, CatalogTool>;
}

/**
 * Guard: a relative argument is resolved against the api's working directory.
 * The reader commands in `.env` are written relative to the api package, and a
 * server started for a conversation is rooted at its workspace, where
 * `../../../packages/...` names nothing.
 */
function absolute(argument: string): string {
  return argument.startsWith(".") ? resolve(argument) : argument;
}

function textOf(result: CallResult): string {
  const blocks = Array.isArray(result.content) ? result.content : [];

  return blocks
    .map((block) =>
      typeof block === "object" &&
      block !== null &&
      "text" in block &&
      typeof block.text === "string"
        ? block.text
        : "",
    )
    .filter((text) => text !== "")
    .join("\n");
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Guard: the worker's token counts are read from its answer's text, where
 * `llm-mcp` answers through `json()`; `structuredContent` arrives empty.
 */
function workerUsageOf(text: string): WorkerUsage | null {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null) {
      return null;
    }
    const input = count((body as Record<string, unknown>)["promptTokens"]);
    const output = count((body as Record<string, unknown>)["outputTokens"]);

    return input === undefined || output === undefined
      ? null
      : { input, output };
  } catch {
    return null;
  }
}

function resultOf(
  result: CallResult,
  extra: Pick<GatewayResult, "workerUsage" | "queuedMs">,
): GatewayResult {
  return { text: textOf(result), isError: result.isError === true, ...extra };
}

/**
 * Assembles the tools one turn may reach through the gateway.
 *
 * Guard: the directory is what `find_tools` searches and what `call_tool`
 * resolves a name against, and nothing else is callable. It is not the
 * enforcement: a remote tool still passes `authorizeInvocation` inside
 * `RemoteToolInvoker` on every call, and every tool passes the turn's approval
 * gate first.
 */
@Injectable()
export class ToolDirectoryService {
  private readonly logger = new Logger(ToolDirectoryService.name);

  private readonly readers: ReaderConfig;

  private readonly codex: CodexConfig;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly store: AttachmentStoreService,
    private readonly catalog: IntegrationCatalogService,
    private readonly invoker: RemoteToolInvoker,
    private readonly pool: AgentServerPool,
    private readonly lanes: WorkerLanes,
  ) {
    this.readers = config.get("readers", { infer: true });
    this.codex = config.get("codex", { infer: true });
  }

  async toolsFor(request: DirectoryRequest): Promise<TurnTools> {
    const [families, remote] = await Promise.all([
      this.store.familiesFor(request.userId, request.sessionId),
      this.remoteCatalog(request.userId),
    ]);
    const groups = await Promise.all([
      ...[...families].map((family) => this.readerEntries(request, family)),
      this.workerEntries(request),
    ]);
    const entries = [
      ...groups.flat(),
      ...[...remote].map(([name, entry]) =>
        this.remoteEntry(request, name, entry),
      ),
    ];

    return {
      directory: new Map(entries.map((entry) => [entry.name, entry])),
      remote,
    };
  }

  private async readerEntries(
    request: DirectoryRequest,
    family: ReaderFamily,
  ): Promise<DirectoryEntry[]> {
    const raw = this.readers[family].command;
    const parsed =
      raw === undefined ? undefined : readerCommandFor(raw, request.filesDir);
    if (parsed === undefined) {
      return [];
    }

    const spec: ServerSpec = {
      command: parsed.command,
      args: parsed.args.map(absolute),
      env: this.readers[family].env,
    };
    const connect = () =>
      this.pool.clientFor(request.sessionId, family, READER_VARIANT, spec);

    try {
      const listed = await (await connect()).listTools();
      const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));

      return readerToolsOf(family).flatMap((entry): DirectoryEntry[] => {
        const served = byName.get(entry.serverName);
        if (served === undefined) {
          return [];
        }
        const description = entry.description ?? served.description ?? "";
        const definition = definitionOf(entry.name) as {
          readonly inputSchema: unknown;
        };

        return [
          {
            name: entry.name,
            server: family,
            description,
            inputSchema: definition.inputSchema,
            searchable: `${entry.name} ${family} ${description}`.toLowerCase(),
            consent: "gate",
            invoke: async (args, signal) =>
              resultOf(
                await (
                  await connect()
                ).callTool({
                  name: entry.serverName,
                  arguments: args,
                  options: { signal },
                }),
                { workerUsage: null, queuedMs: null },
              ),
          },
        ];
      });
    } catch (cause) {
      this.logger.warn(
        `reader unavailable (${family}): ${errorMessage(cause)}`,
      );

      return [];
    }
  }

  /**
   * Guard: the worker's tools skip the approval gate. They run on this
   * product's own model host, read only the conversation's `files` directory,
   * and the one tool that writes adds a new file of the server's naming there —
   * nothing leaves the premises and nothing the reader owns is changed, so a
   * consent prompt would guard nothing.
   */
  private async workerEntries(
    request: DirectoryRequest,
  ): Promise<DirectoryEntry[]> {
    const entry = this.codex.localWorker;
    if (entry === undefined) {
      return [];
    }

    const spec: ServerSpec = {
      command: process.execPath,
      args: [entry],
      env: {
        LIAISO_LLM_BASE_URL: request.worker.baseUrl,
        LIAISO_LLM_MODEL: request.worker.model,
        LIAISO_LLM_ROOT: request.filesDir,
      },
    };
    const connect = () =>
      this.pool.clientFor(
        request.sessionId,
        WORKER_SERVER,
        request.worker.model,
        spec,
      );
    const lane = this.lanes.laneFor(new URL(request.worker.baseUrl).host);

    try {
      const listed = await (await connect()).listTools();

      return listed.tools
        .filter((tool) => WORKER_TOOLS.has(tool.name))
        .map((tool): DirectoryEntry => {
          const description = tool.description ?? "";

          return {
            name: tool.name,
            server: WORKER_SERVER,
            description,
            inputSchema: tool.inputSchema,
            searchable:
              `${tool.name} ${WORKER_SERVER} ${description}`.toLowerCase(),
            consent: "none",
            invoke: async (args, signal) => {
              const client = await connect();
              const { value, queuedMs } = await lane.run(signal, () =>
                client.callTool({
                  name: tool.name,
                  arguments: args,
                  options: { signal },
                }),
              );
              const text = textOf(value);

              return {
                text,
                isError: value.isError === true,
                workerUsage: workerUsageOf(text),
                queuedMs,
              };
            },
          };
        });
    } catch (cause) {
      this.logger.warn(`local worker unavailable: ${errorMessage(cause)}`);

      return [];
    }
  }

  private async remoteCatalog(
    userId: UserId,
  ): Promise<ReadonlyMap<string, CatalogTool>> {
    const catalog = await this.catalog.catalogFor(userId);
    const { byExposedName, conflicts } = resolveToolNames(
      catalog.filter(({ scoped }) => scoped),
    );
    for (const conflict of conflicts) {
      this.logger.warn(
        `dropping ${conflict.remoteName} on ${conflict.integrationPublicId}: its exposed name is already taken`,
      );
    }

    return byExposedName;
  }

  private remoteEntry(
    request: DirectoryRequest,
    name: string,
    entry: CatalogTool,
  ): DirectoryEntry {
    return {
      name,
      server: entry.integrationName,
      description: summarizeRemote(entry),
      inputSchema: sanitizeToolInputSchema(entry.inputSchema),
      searchable: searchableRemote(entry),
      consent: "gate",
      invoke: async (args) => {
        const outcome = await this.invoker.invoke(
          request.userId,
          entry,
          args,
          request.locale,
        );

        return outcome.ok
          ? {
              text: outcome.untrustedServerOutput,
              isError: outcome.serverReportedError,
              workerUsage: null,
              queuedMs: null,
            }
          : {
              text: outcome.error,
              isError: true,
              workerUsage: null,
              queuedMs: null,
            };
      },
    };
  }
}
