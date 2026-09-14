import "reflect-metadata";
import { emailRegistrationSchema } from "@chat/contracts/auth/auth";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";

import { AuthRepository } from "./auth/auth.repository.ts";
import { loadConfig } from "./config/configuration.ts";
import { PasswordService } from "./auth/password.service.ts";
import { DbModule } from "./db/db.module.ts";

const USAGE = `usage: node dist/seed.js
  CHAT_SEED_EMAIL       required
  CHAT_SEED_PASSWORD    required, at least 12 characters
  CHAT_SEED_FIRST_NAME  optional, defaults to "Seed"
  CHAT_SEED_LAST_NAME   optional, defaults to "Account"`;

/**
 * Guard: `AppModule` is deliberately not used. It pulls in S3, Redis and the LLM
 * provider, none of which a seed touches and all of which refuse to boot without
 * their own configuration — a machine that can reach the database would still be
 * unable to seed it.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ".env",
      load: [loadConfig],
    }),
    DbModule,
  ],
  providers: [AuthRepository],
})
class SeedModule {}

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

const context = await NestFactory.createApplicationContext(SeedModule, {
  logger: ["error", "warn"],
});

try {
  const user = await context.get(AuthRepository).upsertVerifiedUser({
    firstName: account.firstName,
    lastName: account.lastName,
    email: account.email,
    passwordHash: await new PasswordService().hash(account.password),
    now: new Date(),
  });
  console.log(`seeded ${user.email} (${user.publicId})`);
} finally {
  await context.close();
}
