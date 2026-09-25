-- AlterTable
ALTER TABLE "app_user" ADD COLUMN "agent_codex_model" TEXT,
ADD COLUMN "agent_effort" TEXT,
ADD COLUMN "agent_worker_model" TEXT;

-- AlterTable
ALTER TABLE "chat_session" ADD COLUMN "agent_codex_model" TEXT,
ADD COLUMN "agent_effort" TEXT,
ADD COLUMN "agent_worker_model" TEXT;
