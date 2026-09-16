-- CreateEnum
CREATE TYPE "IntegrationAuthMode" AS ENUM ('oauth', 'none');

-- Every existing row was registered through the authorization code flow, so the
-- default is what they already are. A fresh type rather than a value added to an
-- existing one: `ALTER TYPE ... ADD VALUE` cannot be used later in the same
-- transaction that adds it, and a migration runs as one.
ALTER TABLE "integration"
  ADD COLUMN "auth_mode" "IntegrationAuthMode" NOT NULL DEFAULT 'oauth';
