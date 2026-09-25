import { randomUUID } from "node:crypto";

import type { SessionId } from "@chat/contracts/chat/session";
import { SESSION_PIN_LIMIT } from "@chat/contracts/chat/session-limits";
import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ChatHistoryService } from "../src/chat/chat-history.service.ts";
import { ChatSessionRepository } from "../src/chat/chat-session.repository.ts";
import { MessageRepository } from "../src/chat/message.repository.ts";
import type { AppConfig } from "../src/config/configuration.ts";
import { DbService } from "../src/db/db.service.ts";
import type { UserId } from "../src/db/ids.ts";

const url = process.env.CHAT_TEST_DATABASE_URL;
const withDatabase = url === undefined ? describe.skip : describe;

function configFor(databaseUrl: string): ConfigService<AppConfig, true> {
  const values: Record<string, unknown> = {
    environment: "development",
    database: { url: databaseUrl, poolMax: 4 },
  };

  return {
    get: (key: string): unknown => values[key],
  } as unknown as ConfigService<AppConfig, true>;
}

withDatabase("chat session ordering and pins", () => {
  let db: DbService;
  let sessions: ChatSessionRepository;
  let messages: MessageRepository;
  let history: ChatHistoryService;
  const users: bigint[] = [];

  beforeAll(() => {
    db = new DbService(configFor(url ?? ""));
    sessions = new ChatSessionRepository(db);
    messages = new MessageRepository(db);
    history = new ChatHistoryService(sessions, messages);
  });

  afterEach(async () => {
    if (users.length > 0) {
      await db.client.user.deleteMany({
        where: { id: { in: users.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  async function owner(): Promise<UserId> {
    const row = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    users.push(row.id);

    return row.id.toString() as UserId;
  }

  async function seed(userId: UserId, count: number): Promise<SessionId[]> {
    const ids: SessionId[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = randomUUID() as SessionId;
      const at = new Date(Date.UTC(2026, 8, 1, 12, index));
      await db.client.chatSession.create({
        data: {
          publicId: id,
          userId: BigInt(userId),
          title: `session ${String(index)}`,
          createdAt: at,
          updatedAt: at,
          lastOpenedAt: at,
        },
      });
      ids.push(id);
    }

    return ids;
  }

  it("moves an opened conversation to the head of recents", async () => {
    const user = await owner();
    const [oldest, , newest] = await seed(user, 3);

    const before = await history.list(user, { limit: 20 });
    expect(before.sessions.map((session) => session.id)[0]).toBe(newest);

    await history.open(user, oldest as SessionId);

    const after = await history.list(user, { limit: 20 });
    expect(after.sessions.map((session) => session.id)[0]).toBe(oldest);
  });

  it("moves a conversation to the head of recents when a turn lands in it", async () => {
    const user = await owner();
    const [oldest, newest] = await seed(user, 2);

    await messages.reconcileTurn({
      userId: user,
      sessionId: oldest as SessionId,
      title: null,
      messages: [
        {
          externalId: "m1",
          seq: 0,
          role: "user",
          parts: [{ type: "text", text: "hello" }],
          text: "hello",
        },
      ],
    });

    const after = await history.list(user, { limit: 20 });
    expect(after.sessions.map((session) => session.id)).toEqual([
      oldest,
      newest,
    ]);
  });

  it("never repeats or skips a row when one is opened between pages", async () => {
    const user = await owner();
    const ids = await seed(user, 4);

    const first = await history.list(user, { limit: 2 });
    expect(first.sessions.map((session) => session.id)).toEqual([
      ids[3],
      ids[2],
    ]);

    expect(first.nextCursor).toBeDefined();

    await history.open(user, ids[0] as SessionId);

    const second = await history.list(user, {
      limit: 2,
      cursor: first.nextCursor ?? "",
    });
    const seen = [...first.sessions, ...second.sessions].map(
      (session) => session.id,
    );

    expect(second.sessions.map((session) => session.id)).toEqual([ids[1]]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("lists pins on the first page only and keeps them out of recents", async () => {
    const user = await owner();
    const [a, b, c, d] = await seed(user, 4);

    const pinned = await history.pin(user, b as SessionId);
    expect(pinned).toMatchObject({ id: b });
    expect(pinned === "limit" ? null : pinned?.pinnedAt).not.toBeNull();

    const first = await history.list(user, { limit: 2 });
    expect(first.pinned?.map((session) => session.id)).toEqual([b]);
    expect(first.sessions.map((session) => session.id)).toEqual([d, c]);
    expect(first.nextCursor).toBeDefined();

    const next = await history.list(user, {
      limit: 2,
      cursor: first.nextCursor ?? "",
    });
    expect(next.pinned).toBeUndefined();
    expect(next.sessions.map((session) => session.id)).toEqual([a]);

    const unpinned = await history.unpin(user, b as SessionId);
    expect(unpinned?.pinnedAt).toBeNull();
    const restored = await history.list(user, { limit: 20 });
    expect(restored.pinned).toEqual([]);
    expect(restored.sessions.map((session) => session.id)).toEqual([
      d,
      c,
      b,
      a,
    ]);
  });

  it("refuses a pin past the cap and treats a repeated pin as a no-op", async () => {
    const user = await owner();
    const ids = await seed(user, SESSION_PIN_LIMIT + 1);

    for (const id of ids.slice(0, SESSION_PIN_LIMIT)) {
      expect(await history.pin(user, id)).not.toBe("limit");
    }

    expect(await history.pin(user, ids[SESSION_PIN_LIMIT] as SessionId)).toBe(
      "limit",
    );
    expect(await history.pin(user, ids[0] as SessionId)).toMatchObject({
      id: ids[0],
    });
  });

  it("lets only one of two racing pins take the last slot", async () => {
    const user = await owner();
    const ids = await seed(user, SESSION_PIN_LIMIT + 1);

    for (const id of ids.slice(0, SESSION_PIN_LIMIT - 1)) {
      await history.pin(user, id);
    }

    const outcomes = await Promise.all([
      history.pin(user, ids[SESSION_PIN_LIMIT - 1] as SessionId),
      history.pin(user, ids[SESSION_PIN_LIMIT] as SessionId),
    ]);

    expect(outcomes.filter((outcome) => outcome === "limit")).toHaveLength(1);
    const count = await db.client.chatSession.count({
      where: { userId: BigInt(user), pinnedAt: { not: null } },
    });
    expect(count).toBe(SESSION_PIN_LIMIT);
  });

  it("does not open or pin another user's conversation", async () => {
    const alice = await owner();
    const bob = await owner();
    const [session] = await seed(alice, 1);

    await history.open(bob, session as SessionId);
    expect(await history.pin(bob, session as SessionId)).toBeUndefined();
    expect(await history.unpin(bob, session as SessionId)).toBeUndefined();

    const row = await db.client.chatSession.findFirstOrThrow({
      where: { publicId: session },
    });
    expect(row.pinnedAt).toBeNull();
    expect(row.lastOpenedAt.toISOString()).toBe("2026-09-01T12:00:00.000Z");
  });
});
