import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type Db } from "../src/client.ts";
import {
  AuthChallengePurpose,
  AuthClientType,
} from "../src/generated/enums.ts";

const execFileAsync = promisify(execFile);
const integration = process.env.CHAT_RUN_DB_TESTS === "true" ? describe : describe.skip;

integration("Prisma sensitive-field omit", () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: Db;

  beforeAll(async () => {
    const configuredUrl = process.env.CHAT_TEST_DATABASE_URL;
    if (configuredUrl === undefined) {
      container = await new PostgreSqlContainer("postgres:17-alpine").start();
    }
    const connectionString = configuredUrl ?? container?.getConnectionUri();
    if (connectionString === undefined) {
      throw new Error("A disposable PostgreSQL connection could not be created");
    }
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, CHAT_DATABASE_URL: connectionString },
    });
    db = createDb({ connectionString, poolMax: 2 });
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    await container?.stop();
  });

  it("omits sensitive hashes and links chats directly to users", async () => {
    const now = new Date();
    const user = await db.user.create({
      data: {
        firstName: "Kaan",
        lastName: "Akın",
        email: "omit@example.com",
        passwordCredential: { create: { passwordHash: "argon2-phc" } },
        challenges: {
          create: {
            purpose: AuthChallengePurpose.verifyEmail,
            target: "omit@example.com",
            secretHash: Buffer.alloc(48, 1),
            expiresAt: new Date(now.getTime() + 60_000),
          },
        },
        sessions: {
          create: {
            clientType: AuthClientType.web,
            expiresAt: new Date(now.getTime() + 60_000),
            refreshTokens: {
              create: {
                generation: 0,
                tokenHash: Buffer.alloc(32, 2),
                expiresAt: new Date(now.getTime() + 60_000),
              },
            },
          },
        },
      },
    });
    const chat = await db.chatSession.create({
      data: { publicId: randomUUID(), userId: user.id },
    });

    const password = await db.userPasswordCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const challenge = await db.authChallenge.findFirstOrThrow();
    const refresh = await db.authRefreshToken.findFirstOrThrow();
    const related = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { chatSessions: true },
    });

    expect(password).not.toHaveProperty("passwordHash");
    expect(challenge).not.toHaveProperty("secretHash");
    expect(refresh).not.toHaveProperty("tokenHash");
    expect(chat.userId).toBe(user.id);
    expect(related.chatSessions).toHaveLength(1);
    expect(related.chatSessions[0]?.id).toBe(chat.id);

    const selected = await db.userPasswordCredential.findUniqueOrThrow({
      where: { userId: user.id },
      omit: { passwordHash: false },
    });
    expect(selected.passwordHash).toBe("argon2-phc");
  });
});
