import type { InvocationDenialReason } from "@chat/contracts/integration/invocation-denial";
import { HttpStatus } from "@nestjs/common";

export type ConnectionErrorCode =
  InvocationDenialReason | "provider_unavailable";

/**
 * Guard: a denied invocation answers 403, never 404. Whether the connection
 * exists is exactly what the authorizer refuses to reveal, and a 404 would
 * separate the two cases by status code alone.
 */
export const HTTP_STATUS_BY_CONNECTION_ERROR: Record<
  ConnectionErrorCode,
  HttpStatus
> = {
  connection_required: HttpStatus.FORBIDDEN,
  connection_revoked: HttpStatus.FORBIDDEN,
  insufficient_connection_scope: HttpStatus.FORBIDDEN,
  reauth_required: HttpStatus.FORBIDDEN,
  provider_unavailable: HttpStatus.BAD_GATEWAY,
};
