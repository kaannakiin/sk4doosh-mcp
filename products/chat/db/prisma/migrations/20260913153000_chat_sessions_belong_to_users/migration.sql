-- Anonymous test sessions have no trustworthy mapping to authenticated users.
TRUNCATE TABLE "chat_session" CASCADE;

ALTER TABLE "chat_session"
  DROP CONSTRAINT "chat_session_owner_id_fkey";

DROP INDEX "chat_session_owner_recent_idx";

ALTER TABLE "chat_session"
  RENAME COLUMN "owner_id" TO "user_id";

ALTER TABLE "chat_session"
  ADD CONSTRAINT "chat_session_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "chat_session_user_recent_idx"
  ON "chat_session"("user_id", "updated_at" DESC, "id" DESC);

DROP TABLE "chat_owner";
