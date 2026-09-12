import { z } from "zod";

/**
 * Guard: this cookie value is the only credential that scopes a read, so it is
 * opaque and never derived from the session id. A session id is minted by the
 * client, travels in query strings and names a directory on disk — an owner
 * token derivable from one would let any caller replay another visitor's
 * history by guessing a uuid.
 */
export const OWNER_COOKIE_NAME = "chat_owner";

/**
 * Guard: 32 bytes is the entropy, 43 characters is what base64url encodes it to
 * without padding. The schema pins the encoded length so a truncated or padded
 * cookie is rejected before it reaches a database lookup.
 */
export const OWNER_TOKEN_BYTES = 32;

export const OWNER_COOKIE_TTL_MS_DEFAULT = 365 * 24 * 60 * 60 * 1000;

export const ownerTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export type OwnerToken = z.infer<typeof ownerTokenSchema>;
