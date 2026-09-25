import type { UIMessage } from "ai";

const HISTORY_MAX_CHARS = 8_000;

function textOf(message: UIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function lastUserIndex(messages: readonly UIMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

export function lastUserText(messages: readonly UIMessage[]): string {
  const message = messages[lastUserIndex(messages)];

  return message === undefined ? "" : textOf(message);
}

/**
 * The conversation before the current request, newest last, for a thread that
 * starts in the middle of it.
 *
 * Guard: bounded from the newest end. A conversation that predates the agent
 * can be arbitrarily long, and the thread's context window is the answer's
 * budget; the oldest exchanges are the ones dropped.
 */
export function historyBefore(
  messages: readonly UIMessage[],
): string | undefined {
  const lines = messages
    .slice(0, Math.max(0, lastUserIndex(messages)))
    .flatMap((message) => {
      const text = textOf(message);

      return text === "" ? [] : [`${message.role}: ${text}`];
    });

  const kept: string[] = [];
  let length = 0;
  for (const line of [...lines].reverse()) {
    length += line.length + 1;
    if (length > HISTORY_MAX_CHARS) {
      break;
    }
    kept.unshift(line);
  }

  return kept.length === 0 ? undefined : kept.join("\n");
}
