-- DropIndex
DROP INDEX "chat_message_seq_key";

-- CreateIndex
CREATE INDEX "chat_message_seq_idx" ON "chat_message"("session_id", "seq");
