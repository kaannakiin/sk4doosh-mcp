import type { Attachment } from "@chat/contracts/attachment/attachment";

/**
 * Puts a session's attachments in the order the visitor added them.
 *
 * Guard: the api already returns them in insertion order, and this restores that
 * order after a local write. Dropping several files starts several uploads at
 * once, so they finish out of order — appending each one as it lands leaves the
 * list in completion order, which reshuffles under the reader's cursor the next
 * time the query refetches.
 *
 * Guard: the public id breaks ties. `createdAt` is a timestamp, so two files
 * stored in the same millisecond would otherwise sort unstably.
 */
export function inAddedOrder(
  attachments: readonly Attachment[],
): readonly Attachment[] {
  return [...attachments].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}
