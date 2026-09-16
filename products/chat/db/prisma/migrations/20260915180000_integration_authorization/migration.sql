-- CreateEnum
CREATE TYPE "DiscoveryFailure" AS ENUM ('resource_mismatch', 'issuer_mismatch', 'insecure_transport', 'pkce_unsupported', 'blocked_address', 'unreachable', 'malformed');

-- CreateTable
CREATE TABLE "integration_authorization" (
    "integration_id" BIGINT NOT NULL,
    "resource" TEXT NOT NULL,
    "metadata_url" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "authorization_endpoint" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "registration_endpoint" TEXT,
    "revocation_endpoint" TEXT,
    "scopes_supported" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "client_issuer" TEXT,
    "client_id" TEXT,
    "client_secret" TEXT,
    "registration_access_token" TEXT,
    "registration_client_uri" TEXT,
    "key_version" SMALLINT,
    "client_secret_expires_at" TIMESTAMPTZ,
    "registered_at" TIMESTAMPTZ,
    "discovered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_after" TIMESTAMPTZ NOT NULL,
    "refresh_failed_at" TIMESTAMPTZ,
    "refresh_failure" "DiscoveryFailure",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_authorization_pkey" PRIMARY KEY ("integration_id")
);

-- CreateIndex
CREATE INDEX "integration_authorization_stale_idx" ON "integration_authorization"("stale_after");

-- AddForeignKey
ALTER TABLE "integration_authorization" ADD CONSTRAINT "integration_authorization_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every url here was named by a server this platform has not met, and the
-- authorization code, the client secret and the registration access token travel
-- to them. The transport is pinned in the table for the same reason
-- `integration_mcp_url_check` pins it, loopback exception included.
ALTER TABLE "integration_authorization"
  ADD CONSTRAINT "integration_authorization_resource_check" CHECK (
    "resource" = btrim("resource")
    AND char_length("resource") BETWEEN 8 AND 2048
    AND (
      "resource" ~ '^https://'
      OR "resource" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
    )
  ),
  ADD CONSTRAINT "integration_authorization_metadata_url_check" CHECK (
    "metadata_url" = btrim("metadata_url")
    AND char_length("metadata_url") BETWEEN 8 AND 2048
    AND (
      "metadata_url" ~ '^https://'
      OR "metadata_url" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
    )
  ),
  -- RFC 8414 section 2: an issuer identifier carries no query and no fragment,
  -- and the well-known url is derived from it. An issuer with either builds a
  -- document url that resolves somewhere other than the server being described.
  ADD CONSTRAINT "integration_authorization_issuer_check" CHECK (
    "issuer" = btrim("issuer")
    AND char_length("issuer") BETWEEN 8 AND 2048
    AND "issuer" !~ '[?#]'
    AND (
      "issuer" ~ '^https://'
      OR "issuer" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
    )
  ),
  ADD CONSTRAINT "integration_authorization_authorization_endpoint_check" CHECK (
    "authorization_endpoint" = btrim("authorization_endpoint")
    AND char_length("authorization_endpoint") BETWEEN 8 AND 2048
    AND "authorization_endpoint" !~ '#'
    AND (
      "authorization_endpoint" ~ '^https://'
      OR "authorization_endpoint" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
    )
  ),
  ADD CONSTRAINT "integration_authorization_token_endpoint_check" CHECK (
    "token_endpoint" = btrim("token_endpoint")
    AND char_length("token_endpoint") BETWEEN 8 AND 2048
    AND "token_endpoint" !~ '#'
    AND (
      "token_endpoint" ~ '^https://'
      OR "token_endpoint" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
    )
  ),
  ADD CONSTRAINT "integration_authorization_registration_endpoint_check" CHECK (
    "registration_endpoint" IS NULL
    OR (
      "registration_endpoint" = btrim("registration_endpoint")
      AND char_length("registration_endpoint") BETWEEN 8 AND 2048
      AND "registration_endpoint" !~ '#'
      AND (
        "registration_endpoint" ~ '^https://'
        OR "registration_endpoint" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
      )
    )
  ),
  ADD CONSTRAINT "integration_authorization_revocation_endpoint_check" CHECK (
    "revocation_endpoint" IS NULL
    OR (
      "revocation_endpoint" = btrim("revocation_endpoint")
      AND char_length("revocation_endpoint") BETWEEN 8 AND 2048
      AND "revocation_endpoint" !~ '#'
      AND (
        "revocation_endpoint" ~ '^https://'
        OR "revocation_endpoint" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
      )
    )
  ),
  -- The registration access token is presented to this url, so it is held to the
  -- same transport rule as the endpoints that receive the client secret.
  ADD CONSTRAINT "integration_authorization_registration_client_uri_check" CHECK (
    "registration_client_uri" IS NULL
    OR (
      "registration_client_uri" = btrim("registration_client_uri")
      AND char_length("registration_client_uri") BETWEEN 8 AND 2048
      AND (
        "registration_client_uri" ~ '^https://'
        OR "registration_client_uri" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
      )
    )
  ),
  -- The element shape is RFC 6749 `scope-token`, not this platform's own `a.b`
  -- vocabulary: a provider legitimately publishes
  -- `https://www.googleapis.com/auth/drive.readonly`. What is refused here is a
  -- cardinality no consent screen can render and the two element values no
  -- caller can act on.
  ADD CONSTRAINT "integration_authorization_scopes_supported_check" CHECK (
    array_position("scopes_supported", NULL) IS NULL
    AND NOT ('' = ANY ("scopes_supported"))
    AND coalesce(array_length("scopes_supported", 1), 0) <= 64
  ),
  -- A `client_id` is issued by one authorization server and means nothing at
  -- another. `client_issuer` records which one issued it, so a refresh that
  -- re-identifies the server cannot keep the registration: the update is refused
  -- here rather than left to whoever remembers to null the client columns.
  ADD CONSTRAINT "integration_authorization_client_issuer_check" CHECK (
    ("client_id" IS NULL) = ("client_issuer" IS NULL)
    AND ("client_issuer" IS NULL OR "client_issuer" = "issuer")
  ),
  ADD CONSTRAINT "integration_authorization_client_id_check" CHECK (
    "client_id" IS NULL
    OR (
      "client_id" = btrim("client_id")
      AND char_length("client_id") BETWEEN 1 AND 512
    )
  ),
  -- Compact JWE with an empty encrypted-key segment, which is what `alg: "dir"`
  -- produces and nothing else does. A plaintext secret written by a path that
  -- forgot to encrypt cannot take this shape.
  ADD CONSTRAINT "integration_authorization_client_secret_check" CHECK (
    "client_secret" IS NULL
    OR (
      "client_secret" ~ '^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
      AND char_length("client_secret") <= 4096
    )
  ),
  ADD CONSTRAINT "integration_authorization_registration_access_token_check" CHECK (
    "registration_access_token" IS NULL
    OR (
      "registration_access_token" ~ '^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
      AND char_length("registration_access_token") <= 4096
    )
  ),
  ADD CONSTRAINT "integration_authorization_key_version_check" CHECK (
    ("key_version" IS NOT NULL) = (
      "client_secret" IS NOT NULL OR "registration_access_token" IS NOT NULL
    )
    AND ("key_version" IS NULL OR "key_version" >= 1)
  ),
  -- The secret, its expiry, the management url and the management token are all
  -- products of one registration; none can exist without the `client_id` that
  -- registration returned.
  ADD CONSTRAINT "integration_authorization_registration_check" CHECK (
    "client_id" IS NOT NULL
    OR (
      "client_secret" IS NULL
      AND "registration_access_token" IS NULL
      AND "registration_client_uri" IS NULL
      AND "client_secret_expires_at" IS NULL
      AND "registered_at" IS NULL
    )
  ),
  -- RFC 7591 sends `client_secret_expires_at` only alongside a secret, and `0`
  -- there means it never expires. Stored as NULL, never as the epoch, which
  -- would read as permanently expired and refuse every connection.
  ADD CONSTRAINT "integration_authorization_client_secret_expiry_check" CHECK (
    "client_secret_expires_at" IS NULL OR "client_secret" IS NOT NULL
  ),
  -- "Never refreshed" and "refreshed, and the server is gone" are different
  -- states: one is retried, the other is surfaced to the connection's owner.
  ADD CONSTRAINT "integration_authorization_refresh_failure_check" CHECK (
    ("refresh_failed_at" IS NULL) = ("refresh_failure" IS NULL)
  ),
  ADD CONSTRAINT "integration_authorization_timestamps_check" CHECK (
    "updated_at" >= "created_at"
    AND "verified_at" >= "discovered_at"
    AND "stale_after" > "verified_at"
    AND ("registered_at" IS NULL OR "registered_at" >= "created_at")
    AND ("refresh_failed_at" IS NULL OR "refresh_failed_at" >= "discovered_at")
  );
