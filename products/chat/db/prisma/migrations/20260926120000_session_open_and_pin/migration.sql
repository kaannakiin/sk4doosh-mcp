ALTER TABLE "chat_session"
  ADD COLUMN "last_opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "pinned_at" TIMESTAMPTZ;

UPDATE "chat_session" SET "last_opened_at" = "updated_at";

DROP INDEX "chat_session_user_recent_idx";

CREATE INDEX "chat_session_user_recent_idx"
  ON "chat_session"("user_id", "last_opened_at" DESC, "id" DESC);
