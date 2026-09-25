import type { AgentSelection } from "@chat/contracts/agent/model";
import type { SessionId } from "@chat/contracts/chat/session";
import { Injectable } from "@nestjs/common";

import type { UserId } from "../db/ids.ts";
import { DbService } from "../db/db.service.ts";

const SELECTION = {
  agentCodexModel: true,
  agentEffort: true,
  agentWorkerModel: true,
} as const;

interface SelectionRow {
  readonly agentCodexModel: string | null;
  readonly agentEffort: string | null;
  readonly agentWorkerModel: string | null;
}

function toSelection(row: SelectionRow): AgentSelection {
  return {
    codexModel: row.agentCodexModel,
    effort: row.agentEffort,
    workerModel: row.agentWorkerModel,
  };
}

function toRow(selection: AgentSelection): SelectionRow {
  return {
    agentCodexModel: selection.codexModel,
    agentEffort: selection.effort,
    agentWorkerModel: selection.workerModel,
  };
}

@Injectable()
export class AgentSelectionRepository {
  constructor(private readonly db: DbService) {}

  async forUser(userId: UserId): Promise<AgentSelection> {
    const row = await this.db.client.user.findUniqueOrThrow({
      where: { id: BigInt(userId) },
      select: SELECTION,
    });

    return toSelection(row);
  }

  async setForUser(userId: UserId, selection: AgentSelection): Promise<void> {
    await this.db.client.user.update({
      where: { id: BigInt(userId) },
      data: toRow(selection),
    });
  }

  async forSession(
    userId: UserId,
    sessionId: SessionId,
  ): Promise<AgentSelection | null> {
    const row = await this.db.client.chatSession.findFirst({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      select: SELECTION,
    });

    return row === null ? null : toSelection(row);
  }

  async setForSession(
    userId: UserId,
    sessionId: SessionId,
    selection: AgentSelection,
  ): Promise<void> {
    await this.db.client.chatSession.updateMany({
      where: { publicId: sessionId, userId: BigInt(userId), deletedAt: null },
      data: toRow(selection),
    });
  }
}
