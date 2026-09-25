import type {
  AgentCatalogResponse,
  AgentSelection,
  CodexModel,
  WorkerModel,
} from "@chat/contracts/agent/model";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Readiness } from "@chat/contracts/http/health";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { AppServerService } from "../codex/app-server/app-server.service.ts";
import type { Model } from "../codex/protocol/generated/v2/Model.ts";
import type { ModelListResponse } from "../codex/protocol/generated/v2/ModelListResponse.ts";
import { errorMessage } from "../common/utils/error.utils.ts";
import type {
  AppConfig,
  CodexConfig,
  LlmConfig,
} from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";
import { AgentSelectionRepository } from "./agent-selection.repository.ts";
import { resolveSelection } from "./resolve-selection.ts";
import { discoverWorkerModels } from "./worker-models.ts";

const CATALOG_TTL_MS = 60_000;

const WORKER_HOST_ID = "main";

interface Listing<T> {
  readonly status: Readiness;
  readonly models: readonly T[];
}

interface Cached<T> {
  readonly at: number;
  readonly value: Promise<Listing<T>>;
}

function toCodexModel(model: Model): CodexModel {
  return {
    id: model.model,
    displayName: model.displayName,
    description: model.description,
    efforts: model.supportedReasoningEfforts.map((option) => ({
      effort: option.reasoningEffort,
      description: option.description,
    })),
    defaultEffort: model.defaultReasoningEffort,
    isDefault: model.isDefault,
    multiAgent: model.multiAgentVersion !== null,
  };
}

@Injectable()
export class ModelCatalogService {
  private readonly logger = new Logger(ModelCatalogService.name);

  private readonly codexSettings: CodexConfig;

  private readonly llm: LlmConfig;

  private codexCache: Cached<CodexModel> | undefined;

  private workerCache: Cached<WorkerModel> | undefined;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly appServer: AppServerService,
    private readonly selections: AgentSelectionRepository,
  ) {
    this.codexSettings = config.get("codex", { infer: true });
    this.llm = config.get("llm", { infer: true });
  }

  async catalogFor(
    userId: UserId,
    sessionId: SessionId | undefined,
  ): Promise<AgentCatalogResponse> {
    const [codex, worker, user, session] = await Promise.all([
      this.codexModels(),
      this.workerModels(),
      this.selections.forUser(userId),
      sessionId === undefined
        ? Promise.resolve(null)
        : this.selections.forSession(userId, sessionId),
    ]);

    return {
      codex: { status: codex.status, models: [...codex.models] },
      worker: { status: worker.status, models: [...worker.models] },
      selection: {
        user,
        session,
        effective: this.resolve(codex, worker, user, session),
      },
    };
  }

  async effectiveFor(
    userId: UserId,
    session: AgentSelection | null,
  ): Promise<AgentSelection> {
    const [codex, worker, user] = await Promise.all([
      this.codexModels(),
      this.workerModels(),
      this.selections.forUser(userId),
    ]);

    return this.resolve(codex, worker, user, session);
  }

  private resolve(
    codex: Listing<CodexModel>,
    worker: Listing<WorkerModel>,
    user: AgentSelection,
    session: AgentSelection | null,
  ): AgentSelection {
    return resolveSelection({
      codexModels: codex.models,
      workerModels: worker.models,
      user,
      session,
      defaults: {
        codexModel: this.codexSettings.model,
        effort: this.codexSettings.effort,
        workerModel: this.llm.model,
      },
    });
  }

  private codexModels(): Promise<Listing<CodexModel>> {
    if (!this.appServer.configured) {
      return Promise.resolve({ status: "unconfigured", models: [] });
    }

    this.codexCache = this.fresh(this.codexCache, () => this.listCodex());

    return this.codexCache.value;
  }

  private workerModels(): Promise<Listing<WorkerModel>> {
    this.workerCache = this.fresh(this.workerCache, () => this.listWorkers());

    return this.workerCache.value;
  }

  private fresh<T>(
    cached: Cached<T> | undefined,
    load: () => Promise<Listing<T>>,
  ): Cached<T> {
    const now = Date.now();

    return cached !== undefined && now - cached.at < CATALOG_TTL_MS
      ? cached
      : { at: now, value: load() };
  }

  private async listCodex(): Promise<Listing<CodexModel>> {
    try {
      const connection = await this.appServer.connection();
      const models: CodexModel[] = [];
      let cursor: string | null = null;
      do {
        const page: ModelListResponse = await connection.request("model/list", {
          cursor,
        });
        models.push(...page.data.map(toCodexModel));
        cursor = page.nextCursor;
      } while (cursor !== null);

      return { status: "ready", models };
    } catch (cause) {
      this.codexCache = undefined;
      this.logger.warn(`codex model list failed: ${errorMessage(cause)}`);

      return { status: "failed", models: [] };
    }
  }

  private async listWorkers(): Promise<Listing<WorkerModel>> {
    try {
      return {
        status: "ready",
        models: await discoverWorkerModels(this.llm.baseUrl, WORKER_HOST_ID),
      };
    } catch (cause) {
      this.workerCache = undefined;
      this.logger.warn(`worker model discovery failed: ${errorMessage(cause)}`);

      return { status: "failed", models: [] };
    }
  }
}
