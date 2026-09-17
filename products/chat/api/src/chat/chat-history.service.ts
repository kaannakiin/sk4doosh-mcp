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
import { Injectable, Logger } from "@nestjs/common";
import type { UIMessage } from "ai";

import type { UserId } from "../db/ids.ts";
import { ChatSessionRepository } from "./chat-session.repository.ts";
import { MessageRepository } from "./message.repository.ts";
import {
  hydrate,
  sealPreliminary,
  titleFrom,
  toInputs,
} from "./message-history.ts";

export interface TurnEnd {
  readonly responseMessage: UIMessage;
  readonly messages: UIMessage[];
  readonly outcome: { readonly status: string };
  readonly finishReason?: string;
}

@Injectable()
export class ChatHistoryService {
  private readonly logger = new Logger(ChatHistoryService.name);

  constructor(
    private readonly sessions: ChatSessionRepository,
    private readonly messages: MessageRepository,
  ) {}

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
    return this.messages.reconcileTurn({
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
    interruptedText: string,
  ): Promise<void> {
    try {
      const messages = sealPreliminary(event.messages, interruptedText);
      const written = await this.messages.reconcileTurn({
        userId,
        sessionId: session,
        messages: toInputs(messages),
        title: titleFrom(messages),
      });
      if (!written) {
        return;
      }

      await this.messages.settleTurn(
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

    const page = await this.sessions.listSessions(userId, {
      limit: query.limit,
      ...(cursor === undefined
        ? {}
        : { cursor: { updatedAt: new Date(cursor.updatedAt), id: cursor.id } }),
    });

    const counts = await this.sessions.attachmentCounts(
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
    const found = await this.summaryOf(userId, session);
    if (found === undefined) {
      return undefined;
    }

    const stored = await this.messages.listMessages(userId, session, limit);
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
    const renamed = await this.sessions.renameSession(userId, session, title);

    return renamed === undefined ? undefined : this.summaryOf(userId, session);
  }

  async remove(userId: UserId, session: SessionId): Promise<boolean> {
    return this.sessions.softDeleteSession(userId, session);
  }

  private async summaryOf(
    userId: UserId,
    session: SessionId,
  ): Promise<SessionSummary | undefined> {
    const row = await this.sessions.findSession(userId, session);
    if (row === undefined) {
      return undefined;
    }
    const counts = await this.sessions.attachmentCounts(userId, [session]);

    return {
      id: row.id,
      title: row.title,
      messageCount: row.messageCount,
      attachmentCount: counts.get(session) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
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
