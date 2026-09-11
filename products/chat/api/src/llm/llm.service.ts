import type { Readiness } from "@chat/contracts/http/health";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createOllama, type OllamaProvider } from "ai-sdk-ollama";

import type { AppConfig, LlmConfig } from "../config/configuration.ts";

const PROBE_TIMEOUT_MS = 5_000;

interface TagsResponse {
  models?: { name?: string }[];
}

export interface LlmStatus {
  model: string;
  status: Readiness;
  detail?: string;
}

@Injectable()
export class LlmService {
  private readonly settings: LlmConfig;

  private readonly provider: OllamaProvider;

  constructor(config: ConfigService<AppConfig, true>) {
    this.settings = config.get("llm", { infer: true });
    this.provider = createOllama({
      baseURL: this.settings.baseUrl,
      apiKey: this.settings.apiKey,
    });
  }

  get timeoutMs(): number {
    return this.settings.timeoutMs;
  }

  get modelId(): string {
    return this.settings.model;
  }

  /**
   * Guard: `num_ctx` and `keep_alive` are sent on every call because the
   * provider sends neither on its own. Without `num_ctx` the window is
   * inherited from whoever last loaded this model on the host; without
   * `keep_alive` the runner can unload between two steps of the same turn,
   * which throws away the prefix KV cache the agent loop depends on and pays
   * the model load again.
   */
  model(): ReturnType<OllamaProvider> {
    return this.provider(this.settings.model, {
      keep_alive: this.settings.keepAlive,
      options: { num_ctx: this.settings.contextTokens },
    });
  }

  get contextTokens(): number {
    return this.settings.contextTokens;
  }

  /**
   * Asks Ollama which models it holds. This is the only place the base URL is
   * exercised outside a chat turn, so `/health` can tell a wrong host apart
   * from a model that was never pulled — two failures that otherwise both
   * surface as an unhelpful mid-stream error.
   */
  async probe(): Promise<LlmStatus> {
    try {
      const response = await fetch(
        new URL("/api/tags", this.settings.baseUrl),
        {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        return {
          model: this.settings.model,
          status: "failed",
          detail: `HTTP ${String(response.status)}`,
        };
      }

      const body = (await response.json()) as TagsResponse;
      const names = (body.models ?? []).map((entry) => entry.name);

      return names.includes(this.settings.model)
        ? { model: this.settings.model, status: "ready" }
        : {
            model: this.settings.model,
            status: "failed",
            detail: "model_not_pulled",
          };
    } catch (cause) {
      return {
        model: this.settings.model,
        status: "failed",
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }
}
