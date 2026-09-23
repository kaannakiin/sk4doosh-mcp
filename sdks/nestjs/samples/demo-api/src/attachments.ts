import type {
  FileResolution,
  FileResolveRequest,
  FileResolver,
} from "@sk-mcp/sdk-nestjs";

interface StoredAttachment {
  readonly owner: string;
  readonly name: string;
  readonly type: string;
  readonly bytes: Buffer;
}

const attachments: ReadonlyMap<string, StoredAttachment> = new Map([
  [
    "att-alice-1",
    {
      owner: "alice",
      name: "invoice.csv",
      type: "text/csv",
      bytes: Buffer.from("line,amount\n1,120\n2,80\n", "utf8"),
    },
  ],
  [
    "att-bob-1",
    {
      owner: "bob",
      name: "notes.txt",
      type: "text/plain",
      bytes: Buffer.from("bob's notes", "utf8"),
    },
  ],
]);

/**
 * The demo's attachment store, scoped to the caller: a ref names a file, and only its owner may
 * send it. A ref is a string the agent wrote, so the owner check is the only thing between one
 * caller and another caller's files.
 */
export class DemoAttachmentResolver implements FileResolver {
  readonly refDescription =
    "An attachment id such as att-alice-1; only its owner can send it.";

  resolve(request: FileResolveRequest): Promise<FileResolution> {
    const found = attachments.get(request.ref);
    if (found === undefined || found.owner !== request.caller.subject) {
      return Promise.resolve({ ok: false, reason: "not_found" });
    }
    if (found.bytes.byteLength > request.maxBytes) {
      return Promise.resolve({ ok: false, reason: "too_large" });
    }
    return Promise.resolve({
      ok: true,
      bytes: found.bytes,
      filename: found.name,
      mediaType: found.type,
    });
  }
}
