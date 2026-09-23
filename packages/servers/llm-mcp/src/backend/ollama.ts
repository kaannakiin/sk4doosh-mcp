import { fail } from "../platform/errors.js";
import type {
  Backend,
  BackendProbe,
  Completion,
  CompletionRequest,
} from "./port.js";

export interface OllamaBackendOptions {
  /** Host root without an /api suffix, for example http://127.0.0.1:11434. */
  readonly baseUrl: string;
  readonly model: string;
  readonly contextTokens: number;
  readonly keepAlive: string;
  readonly timeoutMs: number;
}

const unavailableRecovery =
  "Retry once; if the local model is still unreachable, do the work yourself.";
const refusedRecovery =
  "The local model host rejected the request; do the work yourself.";

function fieldOf(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null && Object.hasOwn(body, key)
    ? (body as Readonly<Record<string, unknown>>)[key]
    : undefined;
}

function countOf(body: unknown, key: string): number {
  const value = fieldOf(body, key);
  return typeof value === "number" ? value : 0;
}

function textOf(body: unknown): string | undefined {
  const content = fieldOf(fieldOf(body, "message"), "content");
  return typeof content === "string" ? content : undefined;
}

function modelNamesOf(body: unknown): readonly unknown[] {
  const models = fieldOf(body, "models");
  return Array.isArray(models)
    ? models.flatMap((entry) => [
        fieldOf(entry, "name"),
        fieldOf(entry, "model"),
      ])
    : [];
}

/**
 * Talks to Ollama's native API, which is the only one that exposes `num_ctx`,
 * `keep_alive` and schema-constrained `format` — the three settings every rule
 * in docs/llm-mcp-plani.md was measured with.
 */
export function createOllamaBackend(options: OllamaBackendOptions): Backend {
  const endpoint = (path: string): string =>
    new URL(path, options.baseUrl).toString();

  /**
   * Guard: Ollama answers a missing model with an `error` field, sometimes on a
   * 200, so the body is checked before the status and before any content is
   * trusted. Otherwise the error string would come back as the model's answer.
   */
  const call = async (
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): Promise<unknown> => {
    const timeout = AbortSignal.timeout(options.timeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint(path), {
        ...init,
        signal:
          signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw fail(
        "backend_unavailable",
        `The local model host did not answer: ${detail}`,
        unavailableRecovery,
      );
    }
    const body: unknown = await response.json().catch(() => undefined);
    const error = fieldOf(body, "error");
    if (typeof error === "string" && error !== "") {
      throw fail(
        "backend_refused",
        `The local model host refused: ${error}`,
        refusedRecovery,
      );
    }
    if (!response.ok) {
      throw fail(
        "backend_refused",
        `The local model host answered HTTP ${String(response.status)}.`,
        refusedRecovery,
      );
    }
    return body;
  };

  const chat = (
    messages: CompletionRequest["messages"],
    extra: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> =>
    call(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages,
          stream: false,
          think: false,
          keep_alive: options.keepAlive,
          ...extra,
        }),
      },
      signal,
    );

  return {
    model: options.model,
    contextTokens: options.contextTokens,

    async complete(request: CompletionRequest): Promise<Completion> {
      const started = performance.now();
      const body = await chat(
        request.messages,
        {
          ...(request.schema === undefined ? {} : { format: request.schema }),
          options: {
            temperature: 0,
            num_ctx: options.contextTokens,
            ...(request.maxOutputTokens === undefined
              ? {}
              : { num_predict: request.maxOutputTokens }),
          },
        },
        request.signal,
      );
      const text = textOf(body);
      if (text === undefined) {
        throw fail(
          "backend_refused",
          "The local model host returned no message content.",
          refusedRecovery,
        );
      }
      return {
        text,
        promptTokens: countOf(body, "prompt_eval_count"),
        outputTokens: countOf(body, "eval_count"),
        durationMs: Math.round(performance.now() - started),
      };
    },

    async probe(signal?: AbortSignal): Promise<BackendProbe> {
      try {
        const body = await call("/api/ps", { method: "GET" }, signal);
        return {
          reachable: true,
          loaded: modelNamesOf(body).includes(options.model),
        };
      } catch (error) {
        return {
          reachable: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    /**
     * Guard: an empty message list makes Ollama load the model and return,
     * which moves the measured 20 s cold start out of the first real call
     * (docs/llm-mcp-plani.md, rule 7). `num_ctx` is sent here too, because a
     * model loaded with a different window is reloaded on the next request.
     */
    async warm(): Promise<void> {
      await chat([], { options: { num_ctx: options.contextTokens } });
    },
  };
}
