-- A provider that grants broad access returns every scope it granted in one
-- space separated list, and 2048 characters was this platform's guess rather
-- than a limit RFC 6749 sets. `https://mcp.cloudflare.com` answers a full-access
-- consent with a list that exceeds it, and the write that recorded a perfectly
-- good grant was refused at the last step.
--
-- The column records what was granted and nothing reads it to decide anything,
-- so the bound exists only to keep a remote server from writing without limit.
ALTER TABLE "connection"
  DROP CONSTRAINT "connection_provider_scope_check",
  ADD CONSTRAINT "connection_provider_scope_check" CHECK (
    "provider_scope" IS NULL
    OR (
      "provider_scope" = btrim("provider_scope")
      AND char_length("provider_scope") BETWEEN 1 AND 8192
    )
  );
