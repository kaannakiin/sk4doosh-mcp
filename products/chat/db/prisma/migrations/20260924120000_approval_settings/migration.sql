-- CreateEnum
CREATE TYPE "IntegrationApprovalMode" AS ENUM ('always_ask', 'remember', 'auto');

-- CreateEnum
CREATE TYPE "ToolOverrideMode" AS ENUM ('always_ask', 'auto');

-- CreateTable
CREATE TABLE "integration_approval_setting" (
    "user_id" BIGINT NOT NULL,
    "integration_id" BIGINT NOT NULL,
    "mode" "IntegrationApprovalMode" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_approval_setting_pkey" PRIMARY KEY ("user_id", "integration_id")
);

-- AddForeignKey
ALTER TABLE "integration_approval_setting" ADD CONSTRAINT "integration_approval_setting_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_approval_setting" ADD CONSTRAINT "integration_approval_setting_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "integration_approval_setting_integration_idx" ON "integration_approval_setting" ("integration_id");

-- Existing integrations get no row, so they keep the reader's own mode exactly
-- as before. Only an integration added from now on starts at `always_ask`, and
-- that row is written by the registration itself.

-- CreateTable
CREATE TABLE "tool_approval_override" (
    "user_id" BIGINT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "integration_id" BIGINT,
    "tool_name" TEXT NOT NULL,
    "mode" "ToolOverrideMode" NOT NULL,
    "definition_digest" BYTEA,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_approval_override_pkey" PRIMARY KEY ("user_id", "subject_key")
);

-- AddForeignKey
ALTER TABLE "tool_approval_override" ADD CONSTRAINT "tool_approval_override_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_approval_override" ADD CONSTRAINT "tool_approval_override_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The subject shapes are the ones `tool_approval` enforces, for the same reason:
-- an override is matched to a tool by `subject_key`, exactly as a grant is, and a
-- shape one table accepts while the other refuses would be a decision that can
-- never meet the tool it was made about.
--
-- An `auto` override must name the definition it was given for; without one it
-- would keep running a tool the server has since rewritten.
ALTER TABLE "tool_approval_override"
  ADD CONSTRAINT "tool_approval_override_subject_key_check" CHECK (
    "subject_key" ~ '^[A-Za-z0-9_.-]{1,128}$'
    OR "subject_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_.-]{1,128}$'
  ),
  ADD CONSTRAINT "tool_approval_override_subject_shape_check" CHECK (
    CASE WHEN "integration_id" IS NULL
      THEN "subject_key" = "tool_name"
      ELSE right("subject_key", char_length("tool_name") + 1) = ':' || "tool_name"
    END
  ),
  ADD CONSTRAINT "tool_approval_override_digest_check" CHECK (
    ("mode" = 'always_ask' AND "definition_digest" IS NULL)
    OR ("mode" = 'auto' AND octet_length("definition_digest") = 32)
  );

CREATE INDEX "tool_approval_override_integration_idx" ON "tool_approval_override" ("integration_id");
