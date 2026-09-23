import { apiEnvSchema } from "@chat/contracts/config/api-env";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface DatabaseConfig {
  url: string;
  poolMax: number;
}

export interface RedisConfig {
  url: string;
  keyPrefix: string;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AuthConfig {
  secret: string;
  publicApiUrl: string;
  webRedirectUrl: string;
  connectionsRedirectUrl: string;
  cookieSecure: boolean;
  cookieSameSite: "lax" | "none";
  google?: OAuthProviderConfig;
  github?: OAuthProviderConfig;
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

/**
 * Guard: there is no `apiKey` here and there must never be one. `home` is the
 * whole of this product's Codex authentication — the sdk is handed an explicit
 * environment, so a credential this interface cannot express is a credential the
 * agent cannot receive, including an `OPENAI_API_KEY` sitting in the server's
 * own environment.
 */
export interface CodexConfig {
  home?: string;
  binary?: string;
  baseUrl?: string;
  model?: string;
  root: string;
  timeoutMs: number;
  maxWorkspaces: number;
  localWorker?: string;
}

export interface AppConfig {
  port: number;
  pathPrefix: string;
  environment: "development" | "test" | "production";
  corsOrigin: string;
  trustProxyHops: number;
  database: DatabaseConfig;
  redis: RedisConfig;
  auth: AuthConfig;
  llm: LlmConfig;
  uploads: UploadConfig;
  storage: StorageConfig;
  cache: CacheConfig;
  sessions: SessionConfig;
  readers: ReaderConfig;
  codex: CodexConfig;
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

function providerConfig(
  clientId: string | undefined,
  clientSecret: string | undefined,
  redirectUri: string | undefined,
): OAuthProviderConfig | undefined {
  return clientId === undefined ||
    clientSecret === undefined ||
    redirectUri === undefined
    ? undefined
    : { clientId, clientSecret, redirectUri };
}

export function loadConfig(): AppConfig {
  const env = apiEnvSchema.parse(process.env);
  const google = providerConfig(
    env.CHAT_AUTH_GOOGLE_CLIENT_ID,
    env.CHAT_AUTH_GOOGLE_CLIENT_SECRET,
    env.CHAT_AUTH_GOOGLE_REDIRECT_URI,
  );
  const github = providerConfig(
    env.CHAT_AUTH_GITHUB_CLIENT_ID,
    env.CHAT_AUTH_GITHUB_CLIENT_SECRET,
    env.CHAT_AUTH_GITHUB_REDIRECT_URI,
  );

  return {
    port: env.CHAT_API_PORT,
    pathPrefix: env.CHAT_API_PATH_PREFIX,
    environment: env.NODE_ENV,
    corsOrigin: env.CHAT_CORS_ORIGIN,
    trustProxyHops: env.CHAT_TRUST_PROXY_HOPS,
    database: {
      url: env.CHAT_DATABASE_URL,
      poolMax: env.CHAT_DB_POOL_MAX,
    },
    redis: {
      url: env.CHAT_REDIS_URL,
      keyPrefix: env.CHAT_REDIS_KEY_PREFIX,
      connectTimeoutMs: env.CHAT_REDIS_CONNECT_TIMEOUT_MS,
      commandTimeoutMs: env.CHAT_REDIS_COMMAND_TIMEOUT_MS,
    },
    auth: {
      secret: env.CHAT_AUTH_SECRET,
      publicApiUrl: env.CHAT_AUTH_PUBLIC_API_URL ?? env.CHAT_CORS_ORIGIN,
      webRedirectUrl:
        env.CHAT_AUTH_WEB_REDIRECT_URL ??
        new URL("/auth/callback", env.CHAT_CORS_ORIGIN).toString(),
      connectionsRedirectUrl:
        env.CHAT_CONNECTIONS_WEB_REDIRECT_URL ??
        new URL("/connections/callback", env.CHAT_CORS_ORIGIN).toString(),
      cookieSecure: env.CHAT_AUTH_COOKIE_SECURE,
      cookieSameSite: env.CHAT_AUTH_COOKIE_SAMESITE,
      google,
      github,
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
    codex: {
      /**
       * Guard: resolved against the process's working directory once, here. The
       * value is handed to a child process that is told to run somewhere else
       * entirely (`--cd <workspace>`), so a relative path only works for as long
       * as nothing changes where the server was started from — and the failure
       * it produces is an agent that says it has no credentials.
       */
      home:
        env.CHAT_CODEX_HOME === undefined
          ? undefined
          : resolve(env.CHAT_CODEX_HOME),
      binary: env.CHAT_CODEX_BIN,
      baseUrl: env.CHAT_CODEX_BASE_URL,
      model: env.CHAT_CODEX_MODEL,
      root: env.CHAT_CODEX_ROOT ?? join(tmpdir(), "chat-codex"),
      timeoutMs: env.CHAT_CODEX_TIMEOUT_MS,
      maxWorkspaces: env.CHAT_CODEX_MAX_WORKSPACES,
      /**
       * Guard: resolved here for the same reason as `home`, and more so — codex
       * starts this server with the conversation's workspace as its working
       * directory, where a relative path points at nothing.
       */
      localWorker:
        env.CHAT_CODEX_LLM_MCP_ENTRY === undefined
          ? undefined
          : resolve(env.CHAT_CODEX_LLM_MCP_ENTRY),
    },
    toolApprovalSecret: env.CHAT_TOOL_APPROVAL_SECRET,
  };
}
