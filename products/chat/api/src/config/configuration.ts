import { apiEnvSchema } from "@chat/contracts/config/api-env";
import type { Locale } from "@chat/contracts/common/locale";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  contextTokens: number;
  keepAlive: string;
}

export interface UploadConfig {
  root: string;
  maxBytes: number;
  maxFiles: number;
  ttlMs: number;
}

export interface SessionConfig {
  idleTtlMs: number;
  maxSessions: number;
}

export interface ReaderConfig {
  workbookCommand?: string;
  documentCommand?: string;
}

export interface AppConfig {
  port: number;
  defaultLocale: Locale;
  corsOrigin: string;
  llm: LlmConfig;
  uploads: UploadConfig;
  sessions: SessionConfig;
  readers: ReaderConfig;
  toolApprovalSecret?: string;
}

export function loadConfig(): AppConfig {
  const env = apiEnvSchema.parse(process.env);

  return {
    port: env.CHAT_API_PORT,
    defaultLocale: env.CHAT_DEFAULT_LOCALE,
    corsOrigin: env.CHAT_CORS_ORIGIN,
    llm: {
      baseUrl: env.CHAT_LLM_BASE_URL,
      model: env.CHAT_LLM_MODEL,
      apiKey: env.CHAT_LLM_API_KEY,
      timeoutMs: env.CHAT_LLM_TIMEOUT_MS,
      contextTokens: env.CHAT_LLM_CONTEXT_TOKENS,
      keepAlive: env.CHAT_LLM_KEEP_ALIVE,
    },
    uploads: {
      root: env.CHAT_UPLOAD_ROOT ?? join(tmpdir(), "chat-uploads"),
      maxBytes: env.CHAT_UPLOAD_MAX_BYTES,
      maxFiles: env.CHAT_UPLOAD_MAX_FILES,
      ttlMs: env.CHAT_ATTACHMENT_TTL_MS,
    },
    sessions: {
      idleTtlMs: env.CHAT_SESSION_IDLE_TTL_MS,
      maxSessions: env.CHAT_MCP_MAX_SESSIONS,
    },
    readers: {
      workbookCommand: env.CHAT_MCP_EXCEL_CMD,
      documentCommand: env.CHAT_MCP_XML_CMD,
    },
    toolApprovalSecret: env.CHAT_TOOL_APPROVAL_SECRET,
  };
}
