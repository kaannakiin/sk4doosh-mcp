-- CreateTable
CREATE TABLE "integration_tool" (
    "integration_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "input_schema" JSONB NOT NULL,
    "discovered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_tool_pkey" PRIMARY KEY ("integration_id", "name")
);

-- AddForeignKey
ALTER TABLE "integration_tool" ADD CONSTRAINT "integration_tool_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "connection" ADD COLUMN "refresh_lease_until" TIMESTAMPTZ;

-- The name shape mirrors `remoteToolNameSchema` in `@chat/contracts`, the same
-- way `integration_tool_scope_tool_name_check` does. Both tables are keyed by
-- the tool name, so a name one of them accepts and the other refuses would be a
-- tool that can declare a scope it can never be listed under.
--
-- `input_schema` is a document a registrant's server wrote and is stored without
-- being understood. It is pinned to an object because that is what a JSON Schema
-- is, and bounded because nothing downstream reads it incrementally.
ALTER TABLE "integration_tool"
  ADD CONSTRAINT "integration_tool_name_check" CHECK (
    "name" ~ '^[A-Za-z0-9_.-]{1,128}$'
  ),
  ADD CONSTRAINT "integration_tool_title_check" CHECK (
    "title" IS NULL
    OR (
      "title" = btrim("title")
      AND char_length("title") BETWEEN 1 AND 200
    )
  ),
  ADD CONSTRAINT "integration_tool_description_check" CHECK (
    "description" IS NULL
    OR char_length("description") BETWEEN 1 AND 8192
  ),
  ADD CONSTRAINT "integration_tool_input_schema_check" CHECK (
    jsonb_typeof("input_schema") = 'object'
    AND char_length("input_schema"::text) <= 65536
  );

-- One person cannot hold the same server twice. Without this a second add makes
-- a second authorization row and a second dynamic client registration against
-- the same authorization server, and the owner is shown two identical entries
-- with no way to tell which one a connection belongs to.
--
-- Partial, because `partner` rows carry no owner and two of them are onboarded
-- by the platform rather than typed in by anyone.
CREATE UNIQUE INDEX "integration_owner_url_key"
  ON "integration" ("owner_id", "mcp_url")
  WHERE "origin" = 'user';

-- A lease is a claim on refreshing this row's token, so it can only exist while
-- there is a token to refresh. The statement that drives a connection out of
-- `active` clears the lease with it; without this check a released row would
-- keep an expired claim that nothing ever reads again.
ALTER TABLE "connection"
  ADD CONSTRAINT "connection_refresh_lease_check" CHECK (
    "refresh_lease_until" IS NULL
    OR "status" = 'active'
  );
