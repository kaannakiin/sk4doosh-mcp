import { emailRegistrationSchema } from "@chat/contracts/auth/auth";
import { databaseUrlSchema } from "@chat/contracts/config/database";
import { createDb, upsertVerifiedUser } from "@chat/db";

import { PasswordService } from "./auth/password.service.ts";

const USAGE = `usage: node dist/seed.js
  CHAT_SEED_EMAIL       required
  CHAT_SEED_PASSWORD    required, at least 12 characters
  CHAT_SEED_FIRST_NAME  optional, defaults to "Seed"
  CHAT_SEED_LAST_NAME   optional, defaults to "Account"`;

/**
 * Guard: the same file `ConfigModule` reads, resolved the same way — relative to
 * the working directory, not to `dist`. A seed that sourced its connection string
 * from anywhere else would write a verified account into a database the server
 * never opens, and report success doing it.
 */
try {
  process.loadEnvFile(".env");
} catch {
  /* exported in the environment, or not needed by this command */
}

function required(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    console.error(`${name} is not set\n\n${USAGE}`);
    process.exit(1);
  }

  return raw;
}

/**
 * Guard: the schema the registration endpoint itself validates against, not a
 * looser one written for the CLI. An account seeded past the password rule
 * authenticates until its first password change and then cannot be re-entered.
 */
const account = emailRegistrationSchema.parse({
  firstName: process.env["CHAT_SEED_FIRST_NAME"] ?? "Seed",
  lastName: process.env["CHAT_SEED_LAST_NAME"] ?? "Account",
  email: required("CHAT_SEED_EMAIL"),
  password: required("CHAT_SEED_PASSWORD"),
});

const db = createDb({
  connectionString: databaseUrlSchema.parse(process.env["CHAT_DATABASE_URL"]),
  poolMax: 1,
});

try {
  const user = await upsertVerifiedUser(db, {
    firstName: account.firstName,
    lastName: account.lastName,
    email: account.email,
    passwordHash: await new PasswordService().hash(account.password),
    now: new Date(),
  });
  console.log(`seeded ${user.email} (${user.publicId})`);
} finally {
  await db.$disconnect();
}
