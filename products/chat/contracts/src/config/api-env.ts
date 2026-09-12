import { z } from "zod";

import {
  ATTACHMENT_MAX_BYTES_DEFAULT,
  ATTACHMENT_MAX_BYTES_HARD,
  ATTACHMENT_MAX_FILES_DEFAULT,
  ATTACHMENT_MAX_FILES_HARD,
  ATTACHMENT_MAX_FILE_BYTES_DEFAULT,
  ATTACHMENT_MAX_FILE_BYTES_HARD,
  CACHE_MAX_BYTES_DEFAULT,
  CACHE_MAX_BYTES_HARD,
  MCP_MAX_SESSIONS_DEFAULT,
  PRESIGN_TTL_S_DEFAULT,
  PRESIGN_TTL_S_HARD,
  SANDBOX_TTL_MS_DEFAULT,
  SESSION_IDLE_TTL_MS_DEFAULT,
} from "../attachment/limits.ts";
import { OWNER_COOKIE_TTL_MS_DEFAULT } from "../chat/owner.ts";
import { DEFAULT_LOCALE, localeSchema } from "../common/locale.ts";
import {
  DB_POOL_MAX_DEFAULT,
  DB_POOL_MAX_HARD,
  databaseUrlSchema,
} from "./database.ts";

/**
 * Guard: `CHAT_MCP_*_CMD` is split on whitespace and executed without a shell,
 * and the sandbox root is appended by the caller as the final positional
 * argument. Keeping it a plain string with no shell means no quoting, no
 * expansion and no injection surface; it also means a path containing a space
 * cannot be expressed, which is the accepted trade.
 */
const mcpCommandSchema = z.string().trim().min(1).optional();

/**
 * Guard: a variable that is present but blank is absent. A committed
 * `.env.example` is copied to `.env` with its values left empty, and the loader
 * hands those over as empty strings — which `.min(1).optional()` rejects instead
 * of falling through to its default. Collapsing the two cases is what makes an
 * unfilled optional variable behave like an unset one, and keeps a required one
 * failing as "received undefined" rather than as "too small".
 */
function blankAsAbsent(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) {
    return raw;
  }

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      ([, value]) => !(typeof value === "string" && value.trim() === ""),
    ),
  );
}

export const apiEnvSchema = z.preprocess(
  blankAsAbsent,
  z
    .object({
      CHAT_API_PORT: z.coerce.number().int().positive().default(5191),
      CHAT_DEFAULT_LOCALE: localeSchema.default(DEFAULT_LOCALE),
      CHAT_CORS_ORIGIN: z.url().default("http://localhost:5190"),

      /**
       * Guard: no default. Session history and attachment metadata have no
       * in-memory fallback any more, so a server that boots without a database is
       * a server that loses every conversation it accepts. Failing at the single
       * `parse` in `configuration.ts` is the whole point.
       */
      CHAT_DATABASE_URL: databaseUrlSchema,
      CHAT_DB_POOL_MAX: z.coerce
        .number()
        .int()
        .positive()
        .max(DB_POOL_MAX_HARD)
        .default(DB_POOL_MAX_DEFAULT),

      CHAT_OWNER_COOKIE_TTL_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(OWNER_COOKIE_TTL_MS_DEFAULT),
      /**
       * Guard: `Secure` is off by default because the dev web server proxies the
       * api under its own plain-http origin, and a `Secure` cookie is dropped
       * there — silently, producing a fresh owner on every request. It must be on
       * wherever the site is served over https.
       */
      CHAT_OWNER_COOKIE_SECURE: z.stringbool().default(false),

      CHAT_LLM_BASE_URL: z.url().default("http://127.0.0.1:11434"),
      CHAT_LLM_MODEL: z.string().trim().min(1).default("qwen3:8b"),
      CHAT_LLM_API_KEY: z.string().trim().min(1).optional(),
      /**
       * Guard: declare the window instead of inheriting it. Ollama keys a model
       * runner on `num_ctx`, so when this is not sent the effective window is
       * whatever the last caller asked for — a shared host was serving the same
       * model at 16384 while another model sat at 32768. Raising this past what the
       * host already has loaded makes Ollama start a second runner for the same
       * weights, so it is a deployment decision, not a default to tune upwards.
       */
      CHAT_LLM_CONTEXT_TOKENS: z.coerce
        .number()
        .int()
        .min(4096)
        .default(16_384),
      CHAT_LLM_KEEP_ALIVE: z.string().trim().min(1).default("10m"),

      /**
       * Guard: this is the per-file ceiling multer aborts on mid-stream, and it is
       * not the session budget. Multer cannot know how much of the budget is left
       * because that is a database read, so the two limits are enforced in two
       * places: bytes never buffered whole here, total bytes checked against
       * Postgres inside the upload transaction.
       */
      CHAT_UPLOAD_MAX_FILE_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .max(ATTACHMENT_MAX_FILE_BYTES_HARD)
        .default(ATTACHMENT_MAX_FILE_BYTES_DEFAULT),
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

      /**
       * Guard: the object store is required, with no default. Attachment bytes have
       * no local fallback any more — a server that boots without one accepts
       * uploads it cannot keep.
       */
      CHAT_S3_ENDPOINT: z.url(),
      /**
       * Guard: SigV4 signs the Host header, so a url signed against the internal
       * endpoint is rejected the moment the browser sends the public one. When the
       * two differ, presigning must happen against this value; when they are the
       * same the split collapses harmlessly, which is also what hides the bug in
       * development.
       */
      CHAT_S3_PUBLIC_ENDPOINT: z.url().optional(),
      CHAT_S3_BUCKET: z
        .string()
        .trim()
        .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u),
      CHAT_S3_ACCESS_KEY: z.string().trim().min(3),
      CHAT_S3_SECRET_KEY: z.string().trim().min(8),
      CHAT_S3_REGION: z.string().trim().min(1).default("us-east-1"),
      CHAT_S3_FORCE_PATH_STYLE: z.stringbool().default(true),
      /**
       * Guard: a presigned url is a bearer credential in a query string — it lands
       * in browser history, in `Referer`, and in any proxy log that records query
       * strings, and it keeps working after the row and the object are deleted.
       * The ceiling is ours, not the protocol's: SigV4 itself allows seven days.
       */
      CHAT_S3_PRESIGN_TTL_S: z.coerce
        .number()
        .int()
        .min(15)
        .max(PRESIGN_TTL_S_HARD)
        .default(PRESIGN_TTL_S_DEFAULT),
      CHAT_S3_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

      /**
       * Guard: this directory is a cache, not a store, and it is process-local. It
       * is wiped at boot because the in-memory byte accounting is the only
       * accounting there is, so a directory surviving a previous process is bytes
       * the budget can never reclaim. Pointing it at a shared volume would make
       * that wipe delete a peer's live cache.
       */
      CHAT_CACHE_ROOT: z.string().trim().min(1).optional(),
      CHAT_CACHE_MAX_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .max(CACHE_MAX_BYTES_HARD)
        .default(CACHE_MAX_BYTES_DEFAULT),
      CHAT_SANDBOX_TTL_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(SANDBOX_TTL_MS_DEFAULT),
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
    })
    .superRefine((env, ctx) => {
      if (env.CHAT_UPLOAD_MAX_FILE_BYTES > env.CHAT_UPLOAD_MAX_BYTES) {
        ctx.addIssue({
          code: "custom",
          path: ["CHAT_UPLOAD_MAX_FILE_BYTES"],
          message: "the per-file ceiling cannot exceed the per-session budget",
        });
      }
    }),
);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
