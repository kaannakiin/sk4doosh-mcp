-- CreateEnum
CREATE TYPE "IntegrationOrigin" AS ENUM ('partner', 'user');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('active', 'revoked', 'reauth_required');

-- CreateEnum
CREATE TYPE "ConnectionEventKind" AS ENUM ('connected', 'reconnected', 'revoked', 'reauth_required');

-- CreateTable
CREATE TABLE "connection" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "user_id" BIGINT NOT NULL,
    "integration_id" BIGINT NOT NULL,
    "provider_subject" TEXT,
    "provider_tenant" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    CONSTRAINT "connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_scope" (
    "connection_id" BIGINT NOT NULL,
    "scope" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connection_scope_pkey" PRIMARY KEY ("connection_id", "scope")
);

-- CreateTable
CREATE TABLE "connection_event" (
    "id" BIGSERIAL NOT NULL,
    "connection_id" BIGINT NOT NULL,
    "kind" "ConnectionEventKind" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connection_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "origin" "IntegrationOrigin" NOT NULL,
    "owner_id" BIGINT,
    "slug" TEXT,
    "display_name" TEXT NOT NULL,
    "mcp_url" TEXT NOT NULL,
    "manifest_version" INTEGER NOT NULL DEFAULT 0,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_tool_scope" (
    "integration_id" BIGINT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    CONSTRAINT "integration_tool_scope_pkey" PRIMARY KEY ("integration_id", "tool_name")
);

-- CreateIndex
CREATE UNIQUE INDEX "connection_public_id_key" ON "connection" ("public_id");

-- CreateIndex
CREATE INDEX "connection_integration_idx" ON "connection" ("integration_id");

-- CreateIndex
CREATE UNIQUE INDEX "connection_user_integration_key" ON "connection" ("user_id", "integration_id");

-- CreateIndex
CREATE INDEX "connection_event_connection_created_idx" ON "connection_event" (
    "connection_id",
    "created_at" DESC
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_public_id_key" ON "integration" ("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_slug_key" ON "integration" ("slug");

-- CreateIndex
CREATE INDEX "integration_owner_idx" ON "integration" ("owner_id");

-- CreateIndex
CREATE INDEX "integration_tool_scope_scope_idx" ON "integration_tool_scope" ("integration_id", "scope");

-- AddForeignKey
ALTER TABLE "connection"
ADD CONSTRAINT "connection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection"
ADD CONSTRAINT "connection_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_scope"
ADD CONSTRAINT "connection_scope_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connection" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_event"
ADD CONSTRAINT "connection_event_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connection" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration"
ADD CONSTRAINT "integration_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_tool_scope"
ADD CONSTRAINT "integration_tool_scope_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A partner integration is onboarded by the platform and belongs to nobody; a
-- user integration is a server one person pointed the product at. `origin`
-- decides whether an invocation is scope checked, so a row that claims one
-- origin while carrying the other's ownership must not exist.
ALTER TABLE "integration"
ADD CONSTRAINT "integration_origin_owner_check" CHECK (
    (
        "origin" = 'partner'
        AND "owner_id" IS NULL
    )
    OR (
        "origin" = 'user'
        AND "owner_id" IS NOT NULL
    )
);

-- The status the authorizer reads and the timestamp the audit reads cannot
-- disagree: a connection is revoked exactly when it carries a revocation time.
ALTER TABLE "connection"
ADD CONSTRAINT "connection_revoked_status_check" CHECK (
    ("status" = 'revoked') = ("revoked_at" IS NOT NULL)
);