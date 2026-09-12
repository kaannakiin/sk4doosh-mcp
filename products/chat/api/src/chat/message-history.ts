import { SESSION_TITLE_MAX_LENGTH } from "@chat/contracts/chat/session-limits";
import type { MessageInput, MessageRow } from "@chat/db";
import { validateUIMessages, type UIMessage } from "ai";

/**
 * Flattens a message's text parts.
 *
 * This is the only place that reads into the AI SDK's part union, which is why
 * it sits beside `hydrate` rather than in the contracts package: the shape
 * belongs to the SDK, and `@chat/contracts` is compiled into the browser bundle.
 */
export function flatten(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * Turns a posted history into rows, positionally.
 *
 * Guard: `seq` is the message's index in what the client posted, not an
 * allocator. That is what makes the write idempotent — a re-sent history lands
 * on the same numbers, and a regeneration that drops the tail leaves a gap the
 * reconcile deletes.
 */
export function toInputs(messages: readonly UIMessage[]): MessageInput[] {
  const inputs: MessageInput[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    inputs.push({
      externalId: message.id,
      seq: index + 1,
      role: message.role,
      parts: message.parts,
      text: flatten(message),
    });
  }

  return inputs;
}

/**
 * Derives a session title from the first thing the visitor said.
 *
 * @returns the trimmed opening, or `null` when there is no text to use
 */
export function titleFrom(messages: readonly UIMessage[]): string | null {
  const first = messages.find((message) => message.role === "user");
  const text = first === undefined ? "" : flatten(first).trim();
  if (text === "") {
    return null;
  }
  if (text.length <= SESSION_TITLE_MAX_LENGTH) {
    return text;
  }

  const cut = text.slice(0, SESSION_TITLE_MAX_LENGTH);
  const boundary = cut.lastIndexOf(" ");

  return `${boundary > 0 ? cut.slice(0, boundary) : cut}…`;
}

/**
 * Revalidates stored turns against the SDK's current part union.
 *
 * Guard: on failure this returns the longest valid prefix that ends on an
 * assistant message, rather than throwing or dropping individual rows. Throwing
 * makes one SDK upgrade brick every stored conversation; dropping from the middle
 * breaks user/assistant alternation and orphans tool-call/tool-result pairs,
 * which the provider then rejects. Ending on an assistant message is what keeps
 * the next turn a well-formed continuation.
 *
 * @returns the messages the SDK accepts, and how many were left behind
 */
export async function hydrate(
  rows: readonly MessageRow[],
): Promise<{ messages: UIMessage[]; dropped: number }> {
  const candidates = rows.map((row) => ({
    id: row.externalId,
    role: row.role,
    parts: row.parts,
  }));

  const whole = await validate(candidates);
  if (whole !== undefined) {
    return { messages: whole, dropped: 0 };
  }

  let low = 0;
  let high = candidates.length;
  let best: UIMessage[] = [];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const prefix = await validate(candidates.slice(0, middle));
    if (prefix === undefined) {
      high = middle - 1;
    } else {
      best = prefix;
      low = middle;
    }
  }

  while (best.length > 0 && best[best.length - 1]?.role !== "assistant") {
    best.pop();
  }

  return { messages: best, dropped: rows.length - best.length };
}

async function validate(
  candidates: readonly unknown[],
): Promise<UIMessage[] | undefined> {
  if (candidates.length === 0) {
    return [];
  }
  try {
    return await validateUIMessages({ messages: candidates });
  } catch {
    return undefined;
  }
}
