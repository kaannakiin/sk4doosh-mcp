-- CreateEnum
CREATE TYPE "AuthClientType" AS ENUM ('web', 'ios', 'android', 'desktop', 'other');

-- CreateEnum
CREATE TYPE "AuthChallengePurpose" AS ENUM ('verifyEmail', 'verifyPhone', 'phoneLogin', 'passwordReset');

-- CreateTable
CREATE TABLE "app_user" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone_e164" TEXT,
    "email_verified_at" TIMESTAMPTZ,
    "phone_verified_at" TIMESTAMPTZ,
    "disabled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_user_first_name_check" CHECK (
        "first_name" = btrim("first_name")
        AND char_length("first_name") BETWEEN 1 AND 100
    ),
    CONSTRAINT "app_user_last_name_check" CHECK (
        "last_name" = btrim("last_name")
        AND char_length("last_name") BETWEEN 1 AND 100
    ),
    CONSTRAINT "app_user_email_check" CHECK (
        "email" IS NULL
        OR (
            "email" = lower(btrim("email"))
            AND char_length("email") BETWEEN 3 AND 320
        )
    ),
    CONSTRAINT "app_user_phone_e164_check" CHECK (
        "phone_e164" IS NULL
        OR "phone_e164" ~ '^\+[1-9][0-9]{7,14}$'
    ),
    CONSTRAINT "app_user_email_verified_check" CHECK (
        "email_verified_at" IS NULL OR "email" IS NOT NULL
    ),
    CONSTRAINT "app_user_phone_verified_check" CHECK (
        "phone_verified_at" IS NULL OR "phone_e164" IS NOT NULL
    ),
    CONSTRAINT "app_user_timestamps_check" CHECK (
        "updated_at" >= "created_at"
        AND ("disabled_at" IS NULL OR "disabled_at" >= "created_at")
        AND ("email_verified_at" IS NULL OR "email_verified_at" >= "created_at")
        AND ("phone_verified_at" IS NULL OR "phone_verified_at" >= "created_at")
    )
);

-- CreateTable
CREATE TABLE "user_password_credential" (
    "user_id" BIGINT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_password_credential_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_password_credential_hash_check" CHECK (
        char_length(btrim("password_hash")) > 0
    ),
    CONSTRAINT "user_password_credential_timestamps_check" CHECK (
        "password_changed_at" >= "created_at"
        AND "updated_at" >= "created_at"
    )
);

-- CreateTable
CREATE TABLE "oauth_account" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "oauth_account_provider_check" CHECK (
        "provider" = lower(btrim("provider"))
        AND char_length("provider") BETWEEN 1 AND 64
    ),
    CONSTRAINT "oauth_account_provider_id_check" CHECK (
        char_length("provider_account_id") BETWEEN 1 AND 512
    ),
    CONSTRAINT "oauth_account_timestamps_check" CHECK (
        "verified_at" >= "created_at"
        AND "last_used_at" >= "created_at"
    )
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "user_id" BIGINT NOT NULL,
    "client_type" "AuthClientType" NOT NULL,
    "device_name" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_session_device_name_check" CHECK (
        "device_name" IS NULL
        OR (
            "device_name" = btrim("device_name")
            AND char_length("device_name") BETWEEN 1 AND 200
        )
    ),
    CONSTRAINT "auth_session_user_agent_check" CHECK (
        "user_agent" IS NULL OR char_length("user_agent") <= 1024
    ),
    CONSTRAINT "auth_session_timestamps_check" CHECK (
        "last_seen_at" >= "created_at"
        AND "expires_at" > "created_at"
        AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
    )
);

-- CreateTable
CREATE TABLE "auth_refresh_token" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "generation" INTEGER NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,

    CONSTRAINT "auth_refresh_token_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_refresh_token_generation_check" CHECK ("generation" >= 0),
    CONSTRAINT "auth_refresh_token_timestamps_check" CHECK (
        "expires_at" > "created_at"
        AND ("consumed_at" IS NULL OR "consumed_at" >= "created_at")
    )
);

-- CreateTable
CREATE TABLE "auth_challenge" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "user_id" BIGINT NOT NULL,
    "purpose" "AuthChallengePurpose" NOT NULL,
    "target" TEXT NOT NULL,
    "secret_hash" BYTEA NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,

    CONSTRAINT "auth_challenge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_challenge_attempts_check" CHECK ("failed_attempts" >= 0),
    CONSTRAINT "auth_challenge_target_check" CHECK (
        (
            "purpose" IN ('verifyEmail', 'passwordReset')
            AND "target" = lower(btrim("target"))
            AND char_length("target") BETWEEN 3 AND 320
        )
        OR (
            "purpose" IN ('verifyPhone', 'phoneLogin')
            AND "target" ~ '^\+[1-9][0-9]{7,14}$'
        )
    ),
    CONSTRAINT "auth_challenge_timestamps_check" CHECK (
        "expires_at" > "created_at"
        AND ("consumed_at" IS NULL OR "consumed_at" >= "created_at")
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_public_id_key" ON "app_user"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_e164_key" ON "app_user"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_account_provider_key" ON "oauth_account"("provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "oauth_account_user_idx" ON "oauth_account"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_public_id_key" ON "auth_session"("public_id");

-- CreateIndex
CREATE INDEX "auth_session_user_state_created_idx" ON "auth_session"("user_id", "revoked_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "auth_session_expires_idx" ON "auth_session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_refresh_token_token_hash_key" ON "auth_refresh_token"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_refresh_token_generation_key" ON "auth_refresh_token"("session_id", "generation");

-- CreateIndex
CREATE INDEX "auth_refresh_token_expires_idx" ON "auth_refresh_token"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenge_public_id_key" ON "auth_challenge"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenge_secret_hash_key" ON "auth_challenge"("secret_hash");

-- CreateIndex
CREATE INDEX "auth_challenge_user_purpose_created_idx" ON "auth_challenge"("user_id", "purpose", "created_at" DESC);

-- CreateIndex
CREATE INDEX "auth_challenge_expires_idx" ON "auth_challenge"("expires_at");

-- AddForeignKey
ALTER TABLE "user_password_credential" ADD CONSTRAINT "user_password_credential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_account" ADD CONSTRAINT "oauth_account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_refresh_token" ADD CONSTRAINT "auth_refresh_token_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
