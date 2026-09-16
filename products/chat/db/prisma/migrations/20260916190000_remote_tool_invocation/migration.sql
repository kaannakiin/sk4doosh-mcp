-- CreateEnum
CREATE TYPE "ToolApprovalMode" AS ENUM ('always_ask', 'remember');

-- How a reader's remembered tool approvals are consulted. `remember` is the
-- default because an unseen tool still asks under it: the mode only silences a
-- repeat of a decision the reader already read and made.
ALTER TABLE "app_user"
  ADD COLUMN "tool_approval_mode" "ToolApprovalMode" NOT NULL DEFAULT 'remember';

-- This table is a cache of a list the remote server owns, not reader data. Every
-- row is rebuilt by the next refresh, which is what makes it honest to add a
-- NOT NULL digest by emptying it rather than by inventing values for rows whose
-- definitions were never hashed.
TRUNCATE "integration_tool";

-- The digest is computed once, at ingest, from the definition the server sent.
-- Computing it at read time instead would depend on jsonb key order surviving
-- three layers unchanged, and V8 reorders integer-like keys during
-- JSON.parse/JSON.stringify — a tool whose properties are named "1" and "a"
-- would hash differently in this process than in the database, and every stored
-- approval would fall on the day a driver changed.
--
-- `destructive` is the resolved fact rather than the annotation document. Only
-- one annotation has a consumer, and a stored fact is what `origin` and
-- `auth_mode` already are; the remaining annotations enter the digest, so a
-- change to any of them asks the reader again without needing a column.
ALTER TABLE "integration_tool"
  ADD COLUMN "definition_digest" BYTEA NOT NULL,
  ADD COLUMN "destructive" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "integration_tool_definition_digest_check" CHECK (
    octet_length("definition_digest") = 32
  );

-- A tool list goes stale because the server may add, rename or withdraw a tool
-- at any time. `tools_refreshed_at` is null for an integration whose list has
-- never been read, which is the one case a chat turn waits for rather than
-- refreshing in the background: a server connected a moment ago would otherwise
-- be invisible for a whole turn.
--
-- `tools_refresh_lease_until` is the claim on refreshing. Unlike the token
-- lease, a caller that loses this race does not wait — a stale tool list is
-- usable and waiting for someone else's network call is pure latency.
--
-- Known limit: these are per integration, not per connection. Two readers
-- connected to the same partner integration share them, so one reader's refresh
-- suppresses the other's for the hour even though their tokens may see
-- different tools. The per-connection home does not exist for `auth_mode`
-- 'none' integrations, which hold no connection row.
ALTER TABLE "integration"
  ADD COLUMN "tools_refreshed_at" TIMESTAMPTZ,
  ADD COLUMN "tools_refresh_lease_until" TIMESTAMPTZ,
  ADD COLUMN "tools_refresh_failed_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "tool_approval" (
    "user_id" BIGINT NOT NULL,
    "integration_id" BIGINT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "definition_digest" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_approval_pkey" PRIMARY KEY ("user_id", "integration_id", "tool_name")
);

-- AddForeignKey
ALTER TABLE "tool_approval" ADD CONSTRAINT "tool_approval_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- There is deliberately no foreign key to `integration_tool`. That table is
-- rewritten wholesale on every refresh — `deleteMany` then `createMany` — so a
-- cascade would empty this one every hour, and a server that briefly answers
-- with an empty list during an outage would erase approvals the reader gave
-- permanently. A tool the server has withdrawn is reported as unavailable by
-- the read path instead.
ALTER TABLE "tool_approval" ADD CONSTRAINT "tool_approval_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The name shape mirrors `integration_tool_name_check`. The two tables are keyed
-- by the same tool name, and a name one accepts while the other refuses would be
-- an approval that can never be matched to the tool it was given for.
ALTER TABLE "tool_approval"
  ADD CONSTRAINT "tool_approval_tool_name_check" CHECK (
    "tool_name" ~ '^[A-Za-z0-9_.-]{1,128}$'
  ),
  ADD CONSTRAINT "tool_approval_definition_digest_check" CHECK (
    octet_length("definition_digest") = 32
  );

-- Postgres does not index the referencing side of a foreign key. Without this,
-- deleting one integration scans every approval row in the table; the primary
-- key's leading `user_id` already covers both the reader's own listing and the
-- cascade from `app_user`.
CREATE INDEX "tool_approval_integration_idx" ON "tool_approval" ("integration_id");
