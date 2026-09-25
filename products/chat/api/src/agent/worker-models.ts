import {
  WORKER_MIN_CONTEXT_TOKENS,
  type WorkerModel,
} from "@chat/contracts/agent/model";

const DISCOVERY_TIMEOUT_MS = 5_000;

interface TagsResponse {
  readonly models?: readonly {
    readonly name: string;
    readonly remote_host?: string;
    readonly details?: { readonly parameter_size?: string };
  }[];
}

interface ShowResponse {
  readonly capabilities?: readonly string[];
  readonly model_info?: Readonly<Record<string, unknown>>;
}

interface PsResponse {
  readonly models?: readonly { readonly name: string }[];
}

async function call<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${path} answered HTTP ${String(response.status)}`);
  }

  return (await response.json()) as T;
}

function contextLengthOf(show: ShowResponse): number | undefined {
  const entry = Object.entries(show.model_info ?? {}).find(([key]) =>
    key.endsWith(".context_length"),
  );

  return typeof entry?.[1] === "number" ? entry[1] : undefined;
}

/**
 * The models on one Ollama host that can serve as the local worker.
 *
 * Guard: a model qualifies by what the host says it can do, never by its name.
 * It must generate text, fit the worker's context window and run on the host
 * itself: an embedding model cannot complete, an OCR model's 8k window is
 * smaller than the one the worker asks for, and a `:cloud` model carries a
 * `remote_host` because its prompts leave the building.
 *
 * @param baseUrl the host's Ollama url
 * @param hostId the name this product gives the host
 * @returns the qualifying models, largest context first
 */
export async function discoverWorkerModels(
  baseUrl: string,
  hostId: string,
): Promise<WorkerModel[]> {
  const [tags, ps] = await Promise.all([
    call<TagsResponse>(baseUrl, "/api/tags"),
    call<PsResponse>(baseUrl, "/api/ps"),
  ]);
  const loaded = new Set((ps.models ?? []).map((entry) => entry.name));
  const local = (tags.models ?? []).filter(
    (entry) => entry.remote_host === undefined,
  );
  const shown = await Promise.all(
    local.map((entry) =>
      call<ShowResponse>(baseUrl, "/api/show", {
        method: "POST",
        body: JSON.stringify({ model: entry.name }),
      }),
    ),
  );

  return local
    .flatMap((entry, index): WorkerModel[] => {
      const show = shown[index];
      const contextLength =
        show === undefined ? undefined : contextLengthOf(show);
      const completes = show?.capabilities?.includes("completion") === true;
      if (
        !completes ||
        contextLength === undefined ||
        contextLength < WORKER_MIN_CONTEXT_TOKENS
      ) {
        return [];
      }

      return [
        {
          id: entry.name,
          hostId,
          parameterSize: entry.details?.parameter_size ?? null,
          contextLength,
          loaded: loaded.has(entry.name),
        },
      ];
    })
    .sort((left, right) => right.contextLength - left.contextLength);
}
