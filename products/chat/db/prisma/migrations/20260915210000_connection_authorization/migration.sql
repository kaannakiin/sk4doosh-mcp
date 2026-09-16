-- AlterTable
ALTER TABLE "connection"
  ADD COLUMN "provider_scope" TEXT,
  ADD COLUMN "access_token" TEXT,
  ADD COLUMN "refresh_token" TEXT,
  ADD COLUMN "token_expires_at" TIMESTAMPTZ,
  ADD COLUMN "token_key_version" SMALLINT,
  ADD COLUMN "authorized_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "connection_attempt" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "integration_id" BIGINT NOT NULL,
    "state_hash" BYTEA NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "key_version" SMALLINT NOT NULL,
    "issuer" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,

    CONSTRAINT "connection_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connection_attempt_state_hash_key" ON "connection_attempt"("state_hash");

-- CreateIndex
CREATE INDEX "connection_attempt_expires_idx" ON "connection_attempt"("expires_at");

-- CreateIndex
CREATE INDEX "connection_attempt_integration_idx" ON "connection_attempt"("integration_id");

-- AddForeignKey
ALTER TABLE "connection_attempt" ADD CONSTRAINT "connection_attempt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_attempt" ADD CONSTRAINT "connection_attempt_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Compact JWE with an empty encrypted-key segment, which is what `alg: "dir"`
-- produces and nothing else does. A token written by a path that forgot to
-- encrypt cannot take this shape.
ALTER TABLE "connection"
  ADD CONSTRAINT "connection_token_shape_check" CHECK (
    (
      "access_token" IS NULL
      OR (
        "access_token" ~ '^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
        AND char_length("access_token") <= 8192
      )
    )
    AND (
      "refresh_token" IS NULL
      OR (
        "refresh_token" ~ '^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
        AND char_length("refresh_token") <= 8192
      )
    )
  ),
  -- Only an active connection holds a token. A row driven to `reauth_required`
  -- or `revoked` has them cleared in the same statement, so a token minted by an
  -- authorization server the integration no longer points at cannot outlive the
  -- reason it was invalidated.
  ADD CONSTRAINT "connection_token_state_check" CHECK (
    (
      "status" = 'active'
      OR (
        "access_token" IS NULL
        AND "refresh_token" IS NULL
        AND "token_expires_at" IS NULL
        AND "token_key_version" IS NULL
      )
    )
    AND ("refresh_token" IS NULL OR "access_token" IS NOT NULL)
    AND ("token_expires_at" IS NULL OR "access_token" IS NOT NULL)
    AND ("token_key_version" IS NOT NULL) = ("access_token" IS NOT NULL)
    AND ("token_key_version" IS NULL OR "token_key_version" >= 1)
    AND ("authorized_at" IS NULL OR "authorized_at" >= "created_at")
  ),
  ADD CONSTRAINT "connection_provider_scope_check" CHECK (
    "provider_scope" IS NULL
    OR (
      "provider_scope" = btrim("provider_scope")
      AND char_length("provider_scope") BETWEEN 1 AND 2048
    )
  );

-- The state is only ever compared, so it is stored as a digest and the digest is
-- the fixed width of SHA-256. The verifier has to be replayed to the token
-- endpoint, so it is a ciphertext of the same shape every other secret here has.
ALTER TABLE "connection_attempt"
  ADD CONSTRAINT "connection_attempt_state_hash_check" CHECK (
    octet_length("state_hash") = 32
  ),
  ADD CONSTRAINT "connection_attempt_code_verifier_check" CHECK (
    "code_verifier" ~ '^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    AND char_length("code_verifier") <= 4096
  ),
  ADD CONSTRAINT "connection_attempt_key_version_check" CHECK (
    "key_version" >= 1
  ),
  -- The authorization code and the client secret travel to `token_endpoint`, and
  -- the browser is sent to `redirect_uri`. Both were snapshotted from a server
  -- this platform has not met, so the transport is pinned here exactly as it is
  -- pinned on `integration_authorization`, loopback exception included.
  ADD CONSTRAINT "connection_attempt_endpoints_check" CHECK (
    "issuer" = btrim("issuer")
    AND "token_endpoint" = btrim("token_endpoint")
    AND "redirect_uri" = btrim("redirect_uri")
    AND "resource" = btrim("resource")
    AND char_length("issuer") BETWEEN 8 AND 2048
    AND char_length("token_endpoint") BETWEEN 8 AND 2048
    AND char_length("redirect_uri") BETWEEN 8 AND 2048
    AND char_length("resource") BETWEEN 8 AND 2048
    AND ("issuer" ~ '^https://' OR "issuer" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)')
    AND ("token_endpoint" ~ '^https://' OR "token_endpoint" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)')
    AND ("redirect_uri" ~ '^https://' OR "redirect_uri" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)')
    AND ("resource" ~ '^https://' OR "resource" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)')
  ),
  ADD CONSTRAINT "connection_attempt_client_id_check" CHECK (
    "client_id" = btrim("client_id")
    AND char_length("client_id") BETWEEN 1 AND 512
  ),
  ADD CONSTRAINT "connection_attempt_scope_check" CHECK (
    "scope" IS NULL
    OR (
      "scope" = btrim("scope")
      AND char_length("scope") BETWEEN 1 AND 2048
    )
  ),
  ADD CONSTRAINT "connection_attempt_timestamps_check" CHECK (
    "expires_at" > "created_at"
    AND ("consumed_at" IS NULL OR "consumed_at" >= "created_at")
  );
