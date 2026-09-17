import type { SessionId } from "@chat/contracts/chat/session";
import {
  CODEX_ACTIVITY_MAX_CHARS,
  CODEX_HEARTBEAT_MS,
  CODEX_MAX_CHANGED_FILES,
  CODEX_MAX_COMMANDS,
  CODEX_MAX_TODOS,
  CODEX_SUMMARY_MAX_CHARS,
} from "@chat/contracts/tools/codex/limits";
import type {
  CodexFailure,
  CodexTaskOutput,
  CodexTodo,
  CodexUsage,
} from "@chat/contracts/tools/codex/task";
import { Injectable, Logger } from "@nestjs/common";
import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";

import { errorMessage } from "../common/utils/error.utils.ts";
import type { UserId } from "../db/ids.ts";
import { ChatSessionRepository } from "../chat/chat-session.repository.ts";
import { CodexClientService } from "./codex-client.ts";

export interface RunRequest {
  readonly userId: UserId;
  readonly session: SessionId;
  readonly workingDirectory: string;
  readonly prompt: string;
  readonly signal: AbortSignal | undefined;
}

function clamp(value: string, max: number): string {
  const single = value.replace(/\s+/gu, " ").trim();

  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

function activityOf(item: ThreadItem): string | undefined {
  switch (item.type) {
    case "command_execution":
      return clamp(item.command, CODEX_ACTIVITY_MAX_CHARS);
    case "file_change":
      return clamp(
        item.changes
          .map((change) => `${change.kind} ${change.path}`)
          .join(", "),
        CODEX_ACTIVITY_MAX_CHARS,
      );
    case "web_search":
      return clamp(item.query, CODEX_ACTIVITY_MAX_CHARS);
    case "agent_message":
    case "reasoning":
      return clamp(item.text, CODEX_ACTIVITY_MAX_CHARS);
    default:
      return undefined;
  }
}

/**
 * Guard: the agent's own words are never rendered as this product's prose, so a
 * failure is classified into the closed vocabulary and its text is kept only as
 * an optional detail the ui may show as quoted output. The two cases worth
 * telling apart are the ones an operator can act on: a missing binary and a
 * credential that was never set up.
 */
function classify(message: string): CodexFailure {
  const text = message.toLowerCase();
  if (text.includes("unable to locate codex cli binaries")) {
    return "codex_binary_missing";
  }
  if (
    text.includes("not logged in") ||
    text.includes("unauthorized") ||
    text.includes("authentication")
  ) {
    return "codex_unauthenticated";
  }

  return "codex_failed";
}

function tick(ms: number): { promise: Promise<"tick">; cancel: () => void } {
  let handle: NodeJS.Timeout | undefined;
  const promise = new Promise<"tick">((resolve) => {
    handle = setTimeout(() => resolve("tick"), ms);
  });

  return {
    promise,
    cancel: () => {
      if (handle !== undefined) {
        clearTimeout(handle);
      }
    },
  };
}

@Injectable()
export class CodexRunnerService {
  private readonly logger = new Logger(CodexRunnerService.name);

  constructor(
    private readonly client: CodexClientService,
    private readonly sessions: ChatSessionRepository,
  ) {}

  /**
   * Runs one agent turn, yielding progress as it happens and a terminal value
   * last.
   *
   * Guard: the terminal value is `yield`ed, never `return`ed. The sdk consumes an
   * async-iterable tool with `for await`, which discards a generator's return
   * value — a returned summary would be dropped and the last progress object
   * would become the result the model reads.
   *
   * Guard: nothing here throws. A throw inside a tool becomes an error whose text
   * the model cannot act on, so every failure leaves by the same door as success:
   * a terminal value naming a key the locale files translate.
   */
  async *run(request: RunRequest): AsyncGenerator<CodexTaskOutput> {
    const started = Date.now();
    const commands: string[] = [];
    const changed = new Set<string>();
    let todos: CodexTodo[] | undefined;
    let step = "";
    let summary = "";
    let usage: CodexUsage | undefined;

    const elapsed = (): number => Date.now() - started;
    const progress = (): CodexTaskOutput => ({
      phase: "running",
      step,
      commands: commands.length,
      changes: changed.size,
      elapsedMs: elapsed(),
      ...(todos === undefined ? {} : { todos }),
    });

    let failure: CodexFailure | undefined;
    let detail: string | undefined;
    let lastError: string | undefined;
    let completed = false;
    let iterator: AsyncIterator<ThreadEvent> | undefined;
    let pending: Promise<IteratorResult<ThreadEvent>> | undefined;

    try {
      const threadId = await this.sessions.codexThreadFor(
        request.userId,
        request.session,
      );
      const thread = this.client.threadFor({
        workingDirectory: request.workingDirectory,
        threadId,
      });
      const { events } = await thread.runStreamed(request.prompt, {
        signal: request.signal,
      });

      iterator = events[Symbol.asyncIterator]();
      pending = iterator.next();
      let dirty = true;

      while (true) {
        const heartbeat = tick(CODEX_HEARTBEAT_MS);
        const settled = await Promise.race([pending, heartbeat.promise]);
        heartbeat.cancel();

        if (settled === "tick") {
          yield progress();
          dirty = false;
          continue;
        }

        if (settled.done === true) {
          break;
        }

        const event: ThreadEvent = settled.value;
        pending = iterator.next();

        if (event.type === "thread.started") {
          await this.sessions.rememberCodexThread(
            request.userId,
            request.session,
            event.thread_id,
          );
          continue;
        }

        if (event.type === "turn.failed") {
          detail = clamp(event.error.message, CODEX_ACTIVITY_MAX_CHARS);
          failure = classify(event.error.message);
          break;
        }

        /**
         * Guard: an `error` event is advisory, not terminal. The runtime reports
         * every transport retry through it — a run that reconnects four times
         * and then succeeds emits four of them — so treating one as the end
         * would abandon a run that was about to work. Only `turn.failed`, or a
         * stream that ends without completing, ends this loop.
         */
        if (event.type === "error") {
          lastError = event.message;
          continue;
        }

        if (event.type === "turn.completed") {
          completed = true;
          usage = {
            inputTokens: event.usage.input_tokens,
            cachedInputTokens: event.usage.cached_input_tokens,
            outputTokens: event.usage.output_tokens,
            reasoningOutputTokens: event.usage.reasoning_output_tokens,
          };
          continue;
        }

        if (
          event.type !== "item.started" &&
          event.type !== "item.updated" &&
          event.type !== "item.completed"
        ) {
          continue;
        }

        const item = event.item;
        if (item.type === "todo_list") {
          todos = item.items.slice(0, CODEX_MAX_TODOS).map((entry) => ({
            text: clamp(entry.text, CODEX_ACTIVITY_MAX_CHARS),
            completed: entry.completed,
          }));
        }

        if (event.type === "item.completed") {
          if (item.type === "command_execution") {
            commands.push(clamp(item.command, CODEX_ACTIVITY_MAX_CHARS));
          }
          if (item.type === "file_change") {
            for (const change of item.changes) {
              changed.add(change.path);
            }
          }
          if (item.type === "agent_message") {
            summary = item.text;
          }
        }

        const activity = activityOf(item);
        if (activity !== undefined && activity !== step) {
          step = activity;
          dirty = true;
        }

        /**
         * Guard: yielded on transitions rather than on every event. The agent
         * emits an update per reasoning token, and one tool output per token is
         * a stream the browser spends its frame budget re-rendering.
         */
        if (dirty && event.type === "item.completed") {
          yield progress();
          dirty = false;
        }
      }
      if (failure === undefined && !completed) {
        detail =
          lastError === undefined
            ? undefined
            : clamp(lastError, CODEX_ACTIVITY_MAX_CHARS);
        failure = classify(lastError ?? "");
      }
    } catch (cause) {
      if (request.signal?.aborted === true) {
        const reason: unknown = request.signal.reason;
        failure =
          reason instanceof Error && reason.name === "TimeoutError"
            ? "codex_timeout"
            : "codex_aborted";
      } else {
        this.logger.warn(`codex run failed: ${errorMessage(cause)}`);
        detail = clamp(errorMessage(cause), CODEX_ACTIVITY_MAX_CHARS);
        failure = classify(lastError ?? errorMessage(cause));
      }
    } finally {
      /**
       * Guard: the event stream is closed explicitly. Walking away from it
       * leaves the sdk's generator suspended, which never runs the cleanup that
       * removes the turn's schema file and never releases the child — one
       * abandoned run per cancelled turn, each holding a process.
       */
      pending?.catch(() => undefined);
      await iterator?.return?.().catch(() => undefined);
    }

    if (failure !== undefined) {
      yield {
        phase: "failed",
        error: failure,
        ...(detail === undefined ? {} : { detail }),
      };

      return;
    }

    const trimmed = summary.slice(0, CODEX_SUMMARY_MAX_CHARS);
    yield {
      phase: "done",
      summary: trimmed,
      changedFiles: [...changed].slice(0, CODEX_MAX_CHANGED_FILES),
      commands: commands.slice(0, CODEX_MAX_COMMANDS),
      truncated:
        trimmed.length < summary.length ||
        changed.size > CODEX_MAX_CHANGED_FILES ||
        commands.length > CODEX_MAX_COMMANDS,
      ...(usage === undefined ? {} : { usage }),
    };
  }
}
