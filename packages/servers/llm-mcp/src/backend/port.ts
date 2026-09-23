export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface CompletionRequest {
  readonly messages: readonly ChatMessage[];
  /** A JSON Schema the answer must match; the host constrains decoding to it. */
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
}

export interface Completion {
  readonly text: string;
  readonly promptTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export type BackendProbe =
  | { readonly reachable: true; readonly loaded: boolean }
  | { readonly reachable: false; readonly detail: string };

/**
 * One model host. Failures are thrown as `SkMcpLlmError` with
 * `backend_unavailable` (no answer) or `backend_refused` (the host said no).
 */
export interface Backend {
  readonly model: string;
  readonly contextTokens: number;
  complete(request: CompletionRequest): Promise<Completion>;
  probe(signal?: AbortSignal): Promise<BackendProbe>;
  warm(): Promise<void>;
}

export interface QueuedBackend extends Backend {
  readonly pending: number;
}
