import { apiEnvSchema } from "@chat/contracts/config/api-env";
import type { Locale } from "@chat/contracts/common/locale";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface DatabaseConfig {
  url: string;
  poolMax: number;
}

export interface OwnerConfig {
  cookieTtlMs: number;
  cookieSecure: boolean;
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  contextTokens: number;
  keepAlive: string;
}

export interface UploadConfig {
  maxFileBytes: number;
  maxBytes: number;
  maxFiles: number;
}

export interface S3Endpoint {
  endPoint: string;
  port: number;
  useSSL: boolean;
}

export interface StorageConfig {
  io: S3Endpoint;
  signer: S3Endpoint;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  pathStyle: boolean;
  presignTtlSeconds: number;
  timeoutMs: number;
}

export interface CacheConfig {
  root: string;
  maxBytes: number;
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
  database: DatabaseConfig;
  owner: OwnerConfig;
  llm: LlmConfig;
  uploads: UploadConfig;
  storage: StorageConfig;
  cache: CacheConfig;
  sessions: SessionConfig;
  readers: ReaderConfig;
  toolApprovalSecret?: string;
}

/**
 * Guard: the scheme and the port are read out of the url rather than configured
 * beside it. A separate boolean and a separate port are a second source of truth
 * that can disagree with the endpoint, and the failure they produce — signing
 * `http` while connecting `https` — surfaces only as `SignatureDoesNotMatch`
 * with nothing in it to point at the cause.
 */
function endpointOf(raw: string): S3Endpoint {
  const url = new URL(raw);
  const useSSL = url.protocol === "https:";

  return {
    endPoint: url.hostname,
    port: Number(url.port) || (useSSL ? 443 : 80),
    useSSL,
  };
}

export function loadConfig(): AppConfig {
  const env = apiEnvSchema.parse(process.env);

  return {
    port: env.CHAT_API_PORT,
    defaultLocale: env.CHAT_DEFAULT_LOCALE,
    corsOrigin: env.CHAT_CORS_ORIGIN,
    database: {
      url: env.CHAT_DATABASE_URL,
      poolMax: env.CHAT_DB_POOL_MAX,
    },
    owner: {
      cookieTtlMs: env.CHAT_OWNER_COOKIE_TTL_MS,
      cookieSecure: env.CHAT_OWNER_COOKIE_SECURE,
    },
    llm: {
      baseUrl: env.CHAT_LLM_BASE_URL,
      model: env.CHAT_LLM_MODEL,
      apiKey: env.CHAT_LLM_API_KEY,
      contextTokens: env.CHAT_LLM_CONTEXT_TOKENS,
      keepAlive: env.CHAT_LLM_KEEP_ALIVE,
    },
    uploads: {
      maxFileBytes: env.CHAT_UPLOAD_MAX_FILE_BYTES,
      maxBytes: env.CHAT_UPLOAD_MAX_BYTES,
      maxFiles: env.CHAT_UPLOAD_MAX_FILES,
    },
    storage: {
      io: endpointOf(env.CHAT_S3_ENDPOINT),
      signer: endpointOf(env.CHAT_S3_PUBLIC_ENDPOINT ?? env.CHAT_S3_ENDPOINT),
      bucket: env.CHAT_S3_BUCKET,
      accessKey: env.CHAT_S3_ACCESS_KEY,
      secretKey: env.CHAT_S3_SECRET_KEY,
      region: env.CHAT_S3_REGION,
      pathStyle: env.CHAT_S3_FORCE_PATH_STYLE,
      presignTtlSeconds: env.CHAT_S3_PRESIGN_TTL_S,
      timeoutMs: env.CHAT_S3_TIMEOUT_MS,
    },
    cache: {
      root: env.CHAT_CACHE_ROOT ?? join(tmpdir(), "chat-cache"),
      maxBytes: env.CHAT_CACHE_MAX_BYTES,
      ttlMs: env.CHAT_SANDBOX_TTL_MS,
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
