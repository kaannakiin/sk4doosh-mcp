ALTER TABLE "integration"
ADD CONSTRAINT "integration_slug_check" CHECK (
    "slug" IS NULL
    OR (
        "slug" = lower(btrim ("slug"))
        AND "slug" ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'
    )
),
ADD CONSTRAINT "integration_display_name_check" CHECK (
    "display_name" = btrim ("display_name")
    AND char_length("display_name") BETWEEN 1 AND 200
),
-- The credential this platform holds is sent to this url and nowhere else, so
-- the transport is constrained here rather than left to whoever writes the
-- registration form. Loopback over http is the named exception the in-repo
-- demo backends need; it cannot reach a third party.
ADD CONSTRAINT "integration_mcp_url_check" CHECK (
    "mcp_url" = btrim ("mcp_url")
    AND char_length("mcp_url") BETWEEN 8 AND 2048
    AND (
        "mcp_url" ~ '^https://'
        OR "mcp_url" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
    )
),
ADD CONSTRAINT "integration_manifest_version_check" CHECK ("manifest_version" >= 0),
ADD CONSTRAINT "integration_timestamps_check" CHECK ("updated_at" >= "created_at");

-- The shapes mirror `remoteToolNameSchema` and `connectionScopeSchema` in
-- `@chat/contracts`. A scope has no wildcard form there because a matcher at
-- invoke time is where a grant widens past the consent screen; repeating the
-- shape here means an ingest path that skips the parser cannot store one.
ALTER TABLE "integration_tool_scope"
ADD CONSTRAINT "integration_tool_scope_tool_name_check" CHECK (
    "tool_name" ~ '^[A-Za-z0-9_.-]{1,128}$'
),
ADD CONSTRAINT "integration_tool_scope_scope_check" CHECK (
    char_length("scope") BETWEEN 3 AND 64
    AND "scope" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
);

ALTER TABLE "connection"
ADD CONSTRAINT "connection_provider_subject_check" CHECK (
    "provider_subject" IS NULL
    OR (
        "provider_subject" = btrim ("provider_subject")
        AND char_length("provider_subject") BETWEEN 1 AND 255
    )
),
ADD CONSTRAINT "connection_provider_tenant_check" CHECK (
    "provider_tenant" IS NULL
    OR (
        "provider_tenant" = btrim ("provider_tenant")
        AND char_length("provider_tenant") BETWEEN 1 AND 255
    )
),
ADD CONSTRAINT "connection_timestamps_check" CHECK (
    (
        "last_used_at" IS NULL
        OR "last_used_at" >= "created_at"
    )
    AND (
        "revoked_at" IS NULL
        OR "revoked_at" >= "created_at"
    )
);

ALTER TABLE "connection_scope"
ADD CONSTRAINT "connection_scope_scope_check" CHECK (
    char_length("scope") BETWEEN 3 AND 64
    AND "scope" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
);