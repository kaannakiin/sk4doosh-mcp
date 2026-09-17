-- A grant is no longer named by the integration it came from. A first-party tool
-- has no integration row to be named by, and the reader approving `read_sheet`
-- is approving the same kind of thing as the reader approving a discovered tool
-- — keying the two apart is what left this product asking about its own readers
-- forever while letting a server it had never met be remembered once.
--
-- `subject_key` is that one name. It is the string the turn already builds in
-- memory: `approvalKey` in the repository produces exactly this shape, so the
-- per-turn read stops joining `integration` to rebuild it.
--
-- `scope_key` is a conversation's `public_id`, or '' for everywhere. It is a
-- value and not a null because it is part of the primary key, and a primary key
-- may not contain nulls; PG15's `UNIQUE NULLS NOT DISTINCT` is a unique
-- constraint rather than a primary key, and Prisma's compound-unique input has
-- no way to spell null either — which is what `upsert` addresses this table by.
ALTER TABLE "tool_approval"
  ADD COLUMN "subject_key" TEXT,
  ADD COLUMN "scope_key"   TEXT NOT NULL DEFAULT '',
  ADD COLUMN "expires_at"  TIMESTAMPTZ;

-- Every row that exists today is a remote grant; the table could hold nothing
-- else. The join is total because `tool_approval_integration_id_fkey` makes it
-- so, and a row it somehow missed is caught by the `SET NOT NULL` below rather
-- than quietly written as an empty key. `public_id` is `uuid`, so its text form
-- is the canonical lowercase one and cannot vary by who wrote the row.
UPDATE "tool_approval" AS a
SET "subject_key" = i."public_id"::text || ':' || a."tool_name"
FROM "integration" AS i
WHERE i."id" = a."integration_id";

ALTER TABLE "tool_approval"
  ALTER COLUMN "subject_key" SET NOT NULL;

-- The swap is collision free by construction: the old key was
-- (user_id, integration_id, tool_name), `integration.public_id` is unique, and
-- every migrated row lands on scope ''. One old row is exactly one new row, so
-- the new unique index cannot fail on data this migration itself wrote.
ALTER TABLE "tool_approval"
  DROP CONSTRAINT "tool_approval_pkey",
  ADD CONSTRAINT "tool_approval_pkey"
    PRIMARY KEY ("user_id", "subject_key", "scope_key");

-- `integration_id` stops being identity and stays only as the cascade handle.
-- Removing an integration must still reap the grants that named its tools, and
-- `ON DELETE CASCADE` is the only form of that which a code path cannot forget
-- to run. It is null for a first-party grant, which has no integration to be
-- reaped by.
--
-- This has to follow the key swap, not precede it: Postgres refuses to drop
-- NOT NULL from a column while it is still part of a primary key, and the old
-- key names this one.
ALTER TABLE "tool_approval"
  ALTER COLUMN "integration_id" DROP NOT NULL;

-- The two subject shapes are disjoint because ':' appears in neither half — a
-- uuid is hex and dashes, a tool name is `[A-Za-z0-9_.-]` — so a first-party
-- name can never be read as a remote pair, and no tool can be named into another
-- integration's grant by choosing its own name.
--
-- `tool_name` is no longer in the key, which means nothing else stops it from
-- disagreeing with the subject it is supposed to be the tail of. The shape check
-- keeps the listing, which still reads `tool_name`, describing the same tool the
-- gate matched on `subject_key`. It uses `right()` rather than `LIKE` because
-- `_` is a LIKE wildcard and half this product's tool names contain one: a
-- pattern built from `read_sheet` would also match `x:readXsheet`.
--
-- The `scope_key` pattern is lowercase on purpose. A case-insensitive one would
-- let `A1B2…` and `a1b2…` be two primary keys for one conversation and split a
-- reader's scoped grants in half; the value is never taken from the client, it
-- is read back off the resolved `chat_session` row.
--
-- `expires_at > created_at` catches the one bug a server-side computation can
-- make: a zero or negative span read out of the preference, which would write a
-- grant that was dead before it was stored.
ALTER TABLE "tool_approval"
  ADD CONSTRAINT "tool_approval_subject_key_check" CHECK (
    "subject_key" ~ '^[A-Za-z0-9_.-]{1,128}$'
    OR "subject_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_.-]{1,128}$'
  ),
  ADD CONSTRAINT "tool_approval_scope_key_check" CHECK (
    "scope_key" = ''
    OR "scope_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT "tool_approval_subject_shape_check" CHECK (
    CASE WHEN "integration_id" IS NULL
      THEN "subject_key" = "tool_name"
      ELSE right("subject_key", char_length("tool_name") + 1) = ':' || "tool_name"
    END
  ),
  ADD CONSTRAINT "tool_approval_expires_at_check" CHECK (
    "expires_at" IS NULL OR "expires_at" > "created_at"
  );

-- CreateEnum
CREATE TYPE "GrantTtl" AS ENUM ('day', 'week', 'never');

-- How long a grant the reader gives from now on stays live. The default is
-- `never`, which is what every grant already written means — a new preference
-- must not reach back and shorten consent that was given under the old one.
--
-- The expiry is materialized onto each row at grant time rather than computed
-- from this column at decision time, for the same reason in the other direction:
-- widening the preference must not silently extend grants already given.
ALTER TABLE "app_user"
  ADD COLUMN "grant_ttl" "GrantTtl" NOT NULL DEFAULT 'never';
