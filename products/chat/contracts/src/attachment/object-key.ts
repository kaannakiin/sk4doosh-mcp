import { z } from "zod";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const STORED_NAME_PATTERN = "[a-z0-9][a-z0-9-]*-[0-9a-f]{8}\\.[a-z0-9]{2,5}";

/**
 * Guard: one path segment — no separator, no `..`, no leading dot. This value is
 * read back from the database rather than computed beside its use, so "it did not
 * come from the request" is not "it is trusted": a bad migration, a manual
 * update, or a future bulk import can put anything in that column, and the
 * materializer writes files as the api user. The shape check runs before the
 * containment check, and both run before a file is opened.
 */
export const sandboxPathSchema = z
  .string()
  .regex(new RegExp(`^${STORED_NAME_PATTERN}$`, "u"));

/**
 * Guard: the key is validated on read as well as on write. It is the only value
 * that reaches the storage client as a path, and the client resolves it against
 * the bucket — a key that escaped this shape would address somebody else's
 * objects.
 */
export const objectKeySchema = z
  .string()
  .max(512)
  .regex(
    new RegExp(
      `^sessions/${UUID_PATTERN}/${UUID_PATTERN}/${STORED_NAME_PATTERN}$`,
      "u",
    ),
  );

export type ObjectKey = z.infer<typeof objectKeySchema>;

/**
 * Builds the address of an attachment's bytes.
 *
 * The attachment id is its own segment so re-uploading the same filename is
 * structurally a non-event: a new id is a new prefix, so nothing is overwritten
 * and there is no version to reason about.
 */
export function objectKeyFor(
  sessionId: string,
  attachmentId: string,
  storedName: string,
): string {
  return `sessions/${sessionId}/${attachmentId}/${storedName}`;
}
