import type { AgentApproval } from "@chat/contracts/agent/approval";
import type { CallToolInput } from "@chat/contracts/tools/discovery/call-tool";
import type { CallToolResult, RequestMeta } from "@modelcontextprotocol/server";
import { Injectable, Logger } from "@nestjs/common";

import { rankByTerms } from "../chat/tool-search.ts";
import { errorMessage } from "../common/utils/error.utils.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { ApprovalHolds } from "./approval-holds.ts";
import type {
  DirectoryEntry,
  GatewayCall,
  GatewayTurn,
} from "./gateway-turn.ts";

function text(value: string, isError: boolean): CallToolResult {
  return { content: [{ type: "text", text: value }], isError };
}

function stringOf(meta: RequestMeta | undefined, key: string): string | null {
  const value = meta?.[key];

  return typeof value === "string" ? value : null;
}

/**
 * What the gateway's two tools do once a grant has resolved to a turn.
 */
@Injectable()
export class GatewayCallsService {
  private readonly logger = new Logger(GatewayCallsService.name);

  constructor(
    private readonly holds: ApprovalHolds,
    private readonly i18n: I18nService,
  ) {}

  find(turn: GatewayTurn, query: string): CallToolResult {
    const found = rankByTerms(
      [...turn.directory.values()],
      query,
      (entry) => entry.searchable,
    ).map((entry) => ({
      name: entry.name,
      server: entry.server,
      description: entry.description,
      inputSchema: entry.inputSchema,
    }));

    return text(
      JSON.stringify(
        found.length === 0
          ? { found, note: this.i18n.t("chat:tools.none", {}, turn.locale) }
          : { found },
      ),
      false,
    );
  }

  /**
   * Runs one call: the name against the directory, then consent, then the tool.
   *
   * Guard: `_meta` only attributes the call. Codex writes the calling thread and
   * the call id there, and both are used to place the call in the turn's
   * telemetry; neither decides anything, because who may call is settled by the
   * grant before this runs.
   *
   * @param turn the turn the grant resolved to
   * @param input the name and arguments the agent sent
   * @param meta the request's `_meta`
   * @returns the tool's answer, or why it did not run
   */
  async call(
    turn: GatewayTurn,
    input: CallToolInput,
    meta: RequestMeta | undefined,
  ): Promise<CallToolResult> {
    const entry = turn.directory.get(input.name);
    if (entry === undefined) {
      return text(
        this.i18n.t(
          "chat:gateway.unknown_tool",
          { name: input.name },
          turn.locale,
        ),
        true,
      );
    }

    const callId = stringOf(meta, "callId");
    const record = (usage: Pick<GatewayCall, "workerUsage" | "queuedMs">) => {
      if (callId !== null) {
        turn.calls.set(callId, {
          server: entry.server,
          tool: entry.name,
          ...usage,
        });
      }
    };
    record({ workerUsage: null, queuedMs: null });

    const refused = await this.consent(turn, entry, stringOf(meta, "threadId"));
    if (refused !== undefined) {
      return refused;
    }

    try {
      const result = await entry.invoke(input.arguments, turn.signal);
      record({ workerUsage: result.workerUsage, queuedMs: result.queuedMs });

      return text(result.text, result.isError);
    } catch (cause) {
      this.logger.warn(
        `gateway call ${entry.server}/${entry.name} failed: ${errorMessage(cause)}`,
      );

      return text(this.i18n.t("chat:gateway.failed", {}, turn.locale), true);
    }
  }

  private async consent(
    turn: GatewayTurn,
    entry: DirectoryEntry,
    threadId: string | null,
  ): Promise<CallToolResult | undefined> {
    if (entry.consent === "none" || turn.allowed.has(entry.name)) {
      return undefined;
    }

    const status = turn.approval.gate(entry.name, false);
    const kind = typeof status === "object" ? status.type : status;
    const reason =
      typeof status === "object" && typeof status.reason === "string"
        ? status.reason
        : undefined;

    if (kind === "not-applicable" || kind === "approved") {
      return undefined;
    }

    if (kind === "user-approval") {
      return this.hold(turn, entry, threadId, reason ?? "");
    }

    return text(
      reason ?? this.i18n.t("chat:approval.denied_unknown", {}, turn.locale),
      true,
    );
  }

  private async hold(
    turn: GatewayTurn,
    entry: DirectoryEntry,
    threadId: string | null,
    reason: string,
  ): Promise<CallToolResult | undefined> {
    const hold = this.holds.hold(turn.userId, turn.signal);
    const part: AgentApproval = {
      approvalId: hold.approvalId,
      threadId: threadId ?? "",
      tool: entry.name,
      server: entry.server,
      reason,
      rememberable: turn.approval.rememberable(entry.name),
      status: "pending",
      expiresAt: hold.expiresAt,
    };
    this.show(turn, part);

    const outcome = await hold.outcome;
    this.show(turn, { ...part, status: outcome.status });

    switch (outcome.status) {
      case "approved":
        if (outcome.remembered) {
          turn.allowed.add(entry.name);
        }

        return undefined;
      case "denied":
        return text(
          this.i18n.t("chat:gateway.declined", {}, turn.locale),
          true,
        );
      default:
        return text(this.i18n.t("chat:gateway.expired", {}, turn.locale), true);
    }
  }

  /**
   * Guard: a write after the turn's stream closed is dropped, not thrown. A hold
   * the turn's end expired settles after `conclude` has finished the stream, and
   * that late status is the only write left for it.
   */
  private show(turn: GatewayTurn, part: AgentApproval): void {
    try {
      turn.writer.write({
        type: "data-agent-approval",
        id: part.approvalId,
        data: part,
      });
    } catch {
      return;
    }
  }
}
