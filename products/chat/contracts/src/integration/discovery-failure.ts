/**
 * Guard: one vocabulary for every way discovery can end without a server. The
 * pure checks return a subset and the transport adds the rest; splitting the two
 * would let the column that records a refresh failure drift from the reasons a
 * refresh can actually produce.
 */
export type DiscoveryFailure =
  | "resource_mismatch"
  | "issuer_mismatch"
  | "insecure_transport"
  | "pkce_unsupported"
  | "blocked_address"
  | "unreachable"
  | "malformed";
