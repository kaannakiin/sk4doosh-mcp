import type { FileRefusalReason } from "@liaiso/core";
import type { InvokeTarget, McpCaller } from "./options.js";

/** What a file resolver is asked to deliver. */
export interface FileResolveRequest {
  /** The string the agent sent. It is not a capability: authorize it against {@link caller}. */
  readonly ref: string;
  /** The multipart field the file travels in. */
  readonly field: string;
  readonly target: InvokeTarget;
  readonly caller: McpCaller;
  /** The per-file byte limit; answer `too_large` rather than loading more. */
  readonly maxBytes: number;
  /** Aborted when the invoke deadline expires or the caller cancels. */
  readonly signal: AbortSignal;
}

export type FileResolution =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly filename?: string;
      readonly mediaType?: string;
    }
  | { readonly ok: false; readonly reason: FileRefusalReason };

/**
 * Turns a `ref` file argument into bytes. liaiso names no storage: the host binds this port, and
 * binding it is what makes `ref` appear in a file argument's schema.
 */
export interface FileResolver {
  /** Shown to the agent as the `ref` key's description, so it knows what a ref is and where to get one. */
  readonly refDescription: string;
  resolve(request: FileResolveRequest): Promise<FileResolution>;
}

export interface LiaisoFileOptions {
  resolver?: FileResolver;
}

/** Raised by the dispatcher when a `ref` was not delivered; the meta-tool layer turns it into an envelope. */
export class LiaisoFileRefused extends Error {
  constructor(
    readonly field: string,
    readonly reason: FileRefusalReason,
    readonly limit: number,
  ) {
    super(`liaiso: file argument '${field}' was refused (${reason}).`);
    this.name = "LiaisoFileRefused";
  }
}
