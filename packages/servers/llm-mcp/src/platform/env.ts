export interface LlmConfig {
  readonly root: string;
  readonly outputDir: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly contextTokens: number;
  readonly keepAlive: string;
  readonly timeoutMs: number;
}

export type EnvRecord = Readonly<Record<string, string | undefined>>;

export type EnvOutcome =
  | { readonly kind: "config"; readonly config: LlmConfig }
  | { readonly kind: "usage"; readonly missing: readonly string[] }
  | { readonly kind: "invalid"; readonly reason: string };

export const requiredNames = ["LIAISO_LLM_MODEL"] as const;

const defaultBaseUrl = "http://127.0.0.1:11434";
const minContextTokens = 4_096;

function count(raw: string | undefined, fallback: number): number | undefined {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function httpUrl(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === "") {
    return defaultBaseUrl;
  }
  if (!URL.canParse(raw)) {
    return undefined;
  }
  const { protocol } = new URL(raw);
  return protocol === "http:" || protocol === "https:" ? raw : undefined;
}

/**
 * Reads the model host settings from an environment record.
 *
 * Guard: pure, and the record is a parameter — the process environment is read
 * once in `cli.ts` and nowhere else, so every variable is named explicitly and
 * `turbo/no-undeclared-env-vars` forces it into `turbo.json`'s `passThroughEnv`.
 *
 * @param cwd the working directory, the root when `LIAISO_LLM_ROOT` is unset
 */
export function readLlmEnv(env: EnvRecord, cwd: string): EnvOutcome {
  const missing = requiredNames.filter((name) => (env[name] ?? "") === "");
  if (missing.length > 0) {
    return { kind: "usage", missing };
  }
  const baseUrl = httpUrl(env["LIAISO_LLM_BASE_URL"]);
  const contextTokens = count(env["LIAISO_LLM_NUM_CTX"], 16_384);
  const timeoutMs = count(env["LIAISO_LLM_TIMEOUT_MS"], 300_000);
  const keepAlive = env["LIAISO_LLM_KEEP_ALIVE"] || "30m";
  if (baseUrl === undefined) {
    return {
      kind: "invalid",
      reason: "LIAISO_LLM_BASE_URL must be an http or https URL.",
    };
  }
  if (contextTokens === undefined || contextTokens < minContextTokens) {
    return {
      kind: "invalid",
      reason: `LIAISO_LLM_NUM_CTX must be an integer of at least ${minContextTokens}.`,
    };
  }
  if (timeoutMs === undefined) {
    return {
      kind: "invalid",
      reason: "LIAISO_LLM_TIMEOUT_MS must be a positive integer.",
    };
  }
  return {
    kind: "config",
    config: {
      root: env["LIAISO_LLM_ROOT"] || cwd,
      outputDir: env["LIAISO_LLM_OUTPUT_DIR"] || ".llm-mcp/out",
      baseUrl,
      model: env["LIAISO_LLM_MODEL"] ?? "",
      contextTokens,
      keepAlive,
      timeoutMs,
    },
  };
}
