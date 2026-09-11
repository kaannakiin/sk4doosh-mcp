import { z } from "zod";

import {
  ATTACHMENT_MAX_BYTES_DEFAULT,
  ATTACHMENT_MAX_BYTES_HARD,
  ATTACHMENT_MAX_FILES_DEFAULT,
  ATTACHMENT_MAX_FILES_HARD,
  ATTACHMENT_TTL_MS_DEFAULT,
  MCP_MAX_SESSIONS_DEFAULT,
  SESSION_IDLE_TTL_MS_DEFAULT,
} from "../attachment/limits.ts";
import { DEFAULT_LOCALE, localeSchema } from "../common/locale.ts";

/**
 * Guard: `CHAT_MCP_*_CMD` is split on whitespace and executed without a shell,
 * and the sandbox root is appended by the caller as the final positional
 * argument. Keeping it a plain string with no shell means no quoting, no
 * expansion and no injection surface; it also means a path containing a space
 * cannot be expressed, which is the accepted trade.
 */
const mcpCommandSchema = z.string().trim().min(1).optional();

export const apiEnvSchema = z.object({
  CHAT_API_PORT: z.coerce.number().int().positive().default(5191),
  CHAT_DEFAULT_LOCALE: localeSchema.default(DEFAULT_LOCALE),
  CHAT_CORS_ORIGIN: z.url().default("http://localhost:5190"),

  CHAT_LLM_BASE_URL: z.url().default("http://127.0.0.1:11434"),
  CHAT_LLM_MODEL: z.string().trim().min(1).default("qwen3:8b"),
  CHAT_LLM_API_KEY: z.string().trim().min(1).optional(),
  CHAT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /**
   * Guard: declare the window instead of inheriting it. Ollama keys a model
   * runner on `num_ctx`, so when this is not sent the effective window is
   * whatever the last caller asked for — a shared host was serving the same
   * model at 16384 while another model sat at 32768. Raising this past what the
   * host already has loaded makes Ollama start a second runner for the same
   * weights, so it is a deployment decision, not a default to tune upwards.
   */
  CHAT_LLM_CONTEXT_TOKENS: z.coerce.number().int().min(4096).default(16_384),
  CHAT_LLM_KEEP_ALIVE: z.string().trim().min(1).default("10m"),

  CHAT_UPLOAD_ROOT: z.string().trim().min(1).optional(),
  CHAT_UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(ATTACHMENT_MAX_BYTES_HARD)
    .default(ATTACHMENT_MAX_BYTES_DEFAULT),
  CHAT_UPLOAD_MAX_FILES: z.coerce
    .number()
    .int()
    .positive()
    .max(ATTACHMENT_MAX_FILES_HARD)
    .default(ATTACHMENT_MAX_FILES_DEFAULT),
  CHAT_ATTACHMENT_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(ATTACHMENT_TTL_MS_DEFAULT),
  CHAT_SESSION_IDLE_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(SESSION_IDLE_TTL_MS_DEFAULT),

  CHAT_MCP_EXCEL_CMD: mcpCommandSchema,
  CHAT_MCP_XML_CMD: mcpCommandSchema,
  CHAT_MCP_MAX_SESSIONS: z.coerce
    .number()
    .int()
    .positive()
    .default(MCP_MAX_SESSIONS_DEFAULT),

  CHAT_TOOL_APPROVAL_SECRET: z.string().min(32).optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
