-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "ReaderFamily" AS ENUM ('workbook', 'document');

-- CreateEnum
CREATE TYPE "TurnOutcome" AS ENUM ('completed', 'failed', 'aborted', 'unknown');

-- CreateTable
CREATE TABLE "chat_attachment" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "session_id" BIGINT NOT NULL,
    "filename" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "family" "ReaderFamily",
    "sandbox_path" TEXT,
    "object_key" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "checksum" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "chat_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "external_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" "MessageRole" NOT NULL,
    "parts" JSONB NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "outcome" "TurnOutcome" NOT NULL DEFAULT 'unknown',
    "finish_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_owner" (
    "id" BIGSERIAL NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_session" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "owner_id" BIGINT NOT NULL,
    "title" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "chat_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_attachment_public_id_key" ON "chat_attachment"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_attachment_object_key_key" ON "chat_attachment"("object_key");

-- CreateIndex
CREATE INDEX "chat_attachment_session_idx" ON "chat_attachment"("session_id");

-- CreateIndex
CREATE INDEX "chat_attachment_tombstone_idx" ON "chat_attachment"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_attachment_sandbox_key" ON "chat_attachment"("session_id", "sandbox_path");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_external_key" ON "chat_message"("session_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_seq_key" ON "chat_message"("session_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "chat_owner_token_hash_key" ON "chat_owner"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "chat_session_public_id_key" ON "chat_session"("public_id");

-- CreateIndex
CREATE INDEX "chat_session_owner_recent_idx" ON "chat_session"("owner_id", "updated_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "chat_attachment" ADD CONSTRAINT "chat_attachment_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "chat_owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
