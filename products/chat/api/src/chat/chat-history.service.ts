import type { SessionId } from "@chat/contracts/chat/session";
import {
  decodeSessionCursor,
  encodeSessionCursor,
} from "@chat/contracts/chat/session-cursor";
import type { SessionDetailResponse } from "@chat/contracts/chat/session-detail";
import type {
  SessionListQuery,
  SessionListResponse,
} from "@chat/contracts/chat/session-page";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import {
  attachmentCounts,
  findSession,
  listMessages,
  listSessions,
  reconcileTurn,
  renameSession,
  settleTurn,
  softDeleteSession,
  type UserId,
} from "@chat/db";
import { Injectable, Logger } from "@nestjs/common";
import type { UIMessage } from "ai";

import { DbService } from "../db/db.service.ts";
import { hydrate, titleFrom, toInputs } from "./message-history.ts";

export interface TurnEnd {
  readonly responseMessage: UIMessage;
  readonly messages: UIMessage[];
  readonly outcome: { readonly status: string };
  readonly finishReason?: string;
}

@Injectable()
export class ChatHistoryService {
  private readonly logger = new Logger(ChatHistoryService.name);

  constructor(private readonly db: DbService) {}

  /**
   * Writes the posted history before the model is called.
   *
   * Guard: this runs before `streamText`, not after it. A process that dies mid
   * generation must not lose the question the visitor just asked, and the write
   * doubles as the ownership check — the session row is locked and matched to
   * this user in the same statement.
   *
   * @returns `false` when the session id belongs to another user
   */
  async persist(
    userId: UserId,
    session: SessionId,
    messages: readonly UIMessage[],
  ): Promise<boolean> {
    return reconcileTurn(this.db.client, {
      userId,
      sessionId: session,
      messages: toInputs(messages),
      title: titleFrom(messages),
    });
  }

  /**
   * Writes the turn once the stream ends, however it ended.
   *
   * Guard: this never throws. It runs inside the stream transform's flush, where
   * a rejection errors a response whose headers are already sent — losing the
   * assistant row is bad, corrupting the answer the visitor is reading is worse.
   */
  async settle(
    userId: UserId,
    session: SessionId,
    event: TurnEnd,
  ): Promise<void> {
    try {
      const written = await reconcileTurn(this.db.client, {
        userId,
        sessionId: session,
        messages: toInputs(event.messages),
        title: titleFrom(event.messages),
      });
      if (!written) {
        return;
      }

      await settleTurn(
        this.db.client,
        userId,
        session,
        event.responseMessage.id,
        outcomeOf(event.outcome.status),
        event.finishReason,
      );
    } catch (cause) {
      this.logger.error(
        cause instanceof Error ? cause.stack : String(cause),
        "failed to settle a turn",
      );
    }
  }

  async list(
    userId: UserId,
    query: SessionListQuery,
  ): Promise<SessionListResponse> {
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeSessionCursor(query.cursor);

    const page = await listSessions(this.db.client, userId, {
      limit: query.limit,
      ...(cursor === undefined
        ? {}
        : { cursor: { updatedAt: new Date(cursor.updatedAt), id: cursor.id } }),
    });

    const counts = await attachmentCounts(
      this.db.client,
      userId,
      page.sessions.map((session) => session.id),
    );

    return {
      sessions: page.sessions.map((session): SessionSummary => ({
        id: session.id,
        title: session.title,
        messageCount: session.messageCount,
        attachmentCount: counts.get(session.id) ?? 0,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      })),
      ...(page.nextCursor === undefined
        ? {}
        : {
            nextCursor: encodeSessionCursor({
              updatedAt: page.nextCursor.updatedAt.toISOString(),
              id: page.nextCursor.id,
            }),
          }),
    };
  }

  /**
   * Everything needed to reopen a conversation, minus its attachments.
   *
   * @returns `undefined` when the session does not exist for this user
   */
  async load(
    userId: UserId,
    session: SessionId,
    limit: number,
  ): Promise<Omit<SessionDetailResponse, "attachments"> | undefined> {
    const found = await findSessionOf(this.db, userId, session);
    if (found === undefined) {
      return undefined;
    }

    const stored = await listMessages(this.db.client, userId, session, limit);
    const { messages, dropped } = await hydrate(stored.messages);
    if (dropped > 0) {
      this.logger.warn(
        `dropped ${String(dropped)} unreadable message(s) from a session`,
      );
    }

    return {
      session: found,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "assistant" : "user",
        parts: message.parts,
        createdAt: createdAtOf(stored.messages, message.id),
      })),
      truncated: stored.truncated || dropped > 0,
    };
  }

  /**
   * Retitles a conversation.
   *
   * Guard: the api owns the first title — the opening turn's reconcile writes it
   * with `coalesce(title, …)` — and this overwrites it on the visitor's request.
   * The coalesce is what keeps a later turn from reverting that choice.
   *
   * @returns `undefined` when the session does not exist for this user
   */
  async rename(
    userId: UserId,
    session: SessionId,
    title: string,
  ): Promise<SessionSummary | undefined> {
    const renamed = await renameSession(this.db.client, userId, session, title);

    return renamed === undefined
      ? undefined
      : findSessionOf(this.db, userId, session);
  }

  async remove(userId: UserId, session: SessionId): Promise<boolean> {
    return softDeleteSession(this.db.client, userId, session);
  }
}

async function findSessionOf(
  db: DbService,
  userId: UserId,
  session: SessionId,
): Promise<SessionSummary | undefined> {
  const row = await findSession(db.client, userId, session);
  if (row === undefined) {
    return undefined;
  }
  const counts = await attachmentCounts(db.client, userId, [session]);

  return {
    id: row.id,
    title: row.title,
    messageCount: row.messageCount,
    attachmentCount: counts.get(session) ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function createdAtOf(
  rows: readonly { externalId: string; createdAt: Date }[],
  id: string,
): string {
  return (
    rows.find((row) => row.externalId === id)?.createdAt ?? new Date()
  ).toISOString();
}

function outcomeOf(
  status: string,
): "completed" | "failed" | "aborted" | "unknown" {
  return status === "completed" || status === "failed" || status === "aborted"
    ? status
    : "unknown";
}
