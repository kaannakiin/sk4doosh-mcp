-- AlterTable
ALTER TABLE "integration_authorization"
  ADD COLUMN "token_endpoint_auth_method" TEXT,
  ADD COLUMN "registered_redirect_uri" TEXT;

-- The authorization server decides how this platform authenticates at the token
-- endpoint, and it may answer with a method other than the one that was asked
-- for. Guessing it at token time is an authentication failure on every request,
-- so it is stored. The set is the three this platform can actually perform: a
-- row carrying `private_key_jwt` would be a registration that cannot be used,
-- and it is refused here rather than discovered on the first connection.
ALTER TABLE "integration_authorization"
  ADD CONSTRAINT "integration_authorization_auth_method_check" CHECK (
    ("client_id" IS NULL) = ("token_endpoint_auth_method" IS NULL)
    AND (
      "token_endpoint_auth_method" IS NULL
      OR (
        "token_endpoint_auth_method" IN (
          'client_secret_basic', 'client_secret_post', 'none'
        )
        AND ("token_endpoint_auth_method" = 'none') = ("client_secret" IS NULL)
      )
    )
  ),
  -- The redirect uri is part of what was registered, and an authorization
  -- request naming a different one is refused by the server with an error that
  -- names neither value. Storing what was sent lets the mismatch be found before
  -- the user is sent to the server, and answered by registering again.
  ADD CONSTRAINT "integration_authorization_redirect_uri_check" CHECK (
    ("client_id" IS NULL) = ("registered_redirect_uri" IS NULL)
    AND (
      "registered_redirect_uri" IS NULL
      OR (
        "registered_redirect_uri" = btrim("registered_redirect_uri")
        AND char_length("registered_redirect_uri") BETWEEN 8 AND 2048
        AND (
          "registered_redirect_uri" ~ '^https://'
          OR "registered_redirect_uri" ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?(/|$)'
        )
      )
    )
  );
