/// <reference types="node" />

import { defineConfig } from "prisma/config";

/**
 * Guard: the CLI and the API read the same variable name, and the value lives in
 * exactly one file — the API's `.env`. `process.loadEnvFile` makes that reachable
 * without a `dotenv` dependency and without a second `.env` in this package that
 * would drift from the one the server actually boots with. The catch is load
 * bearing: CI exports the variable instead of shipping the file.
 */
try {
  process.loadEnvFile(new URL("../api/.env", import.meta.url).pathname);
} catch {
  /* exported in the environment, or not needed by this command */
}

/**
 * Guard: an empty variable is absent, not a value. Prisma rejects an empty
 * `shadowDatabaseUrl` outright, and a required `url` makes every command fail —
 * `prisma generate` included, which Turbo runs on a clean checkout before any
 * database exists. A key present but blank is what a committed `.env.example`
 * produces, so the two cases must collapse.
 */
function optional(name: string): string | undefined {
  const raw = process.env[name];

  return raw === undefined || raw.trim() === "" ? undefined : raw.trim();
}

const url = optional("CHAT_DATABASE_URL");
const shadowDatabaseUrl = optional("CHAT_DATABASE_SHADOW_URL");

export default defineConfig({
  schema: "prisma/schema",
  migrations: { path: "prisma/migrations" },
  ...(url === undefined
    ? {}
    : {
        datasource: {
          url,
          ...(shadowDatabaseUrl === undefined ? {} : { shadowDatabaseUrl }),
        },
      }),
});
