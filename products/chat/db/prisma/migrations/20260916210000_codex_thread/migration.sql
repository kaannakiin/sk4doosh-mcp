-- The Codex thread a conversation continues. It is minted by the agent runtime
-- and lives in `$CODEX_HOME/sessions`; this column only remembers which one so a
-- second request can resume it instead of making the agent rediscover the work.
--
-- Nullable with no default and no backfill: every existing conversation, and
-- every new one until its first agent run, legitimately has no thread. A sentinel
-- would be a thread id that resolving would fail on.
--
-- No index. The column is read only by primary key, on a row the request has
-- already located and locked by `(public_id, user_id)`.
ALTER TABLE "chat_session"
  ADD COLUMN "codex_thread_id" TEXT;
