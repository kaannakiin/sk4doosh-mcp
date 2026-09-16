import type { ExposedToolName } from "@chat/contracts/chat/exposed-tool-name";

import { sha256Bytes } from "../common/utils/crypto.utils.ts";

const HANDLE_LENGTH = 8;

const SEGMENT_LIMIT = 46;

const SUFFIX_LENGTH = 7;

function digestOf(value: string, length: number): string {
  return sha256Bytes(value).toString("hex").slice(0, length);
}

/**
 * Guard: `toLowerCase`, never `toLocaleLowerCase`. Under a Turkish locale the
 * latter maps `I` to a dotless `ı`, which is outside the exposed name's charset
 * and would make the same tool resolve differently depending on where the
 * process runs.
 */
function sanitize(remoteName: string): string {
  return remoteName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

/**
 * The name a remote tool is offered to the model under.
 *
 * Guard: derived from the integration's public id and the remote name and
 * nothing else, so it is stable across turns. A conversation's history holds
 * these names, and one that moved would leave every earlier tool call pointing
 * at nothing.
 *
 * Guard: a name that had to be changed to fit carries a digest of the original.
 * Two tools that differ only past the truncation point, or only in punctuation,
 * would otherwise collapse onto one name and one of them would become
 * unreachable.
 *
 * @param integrationPublicId the integration's public id, never its display name
 * @param remoteName the tool name as the server published it
 * @returns the provider-safe name this platform offers the tool under
 */
export function exposedToolNameFor(
  integrationPublicId: string,
  remoteName: string,
): ExposedToolName {
  const handle = `i${digestOf(integrationPublicId, HANDLE_LENGTH)}`;
  const sanitized = sanitize(remoteName);
  const segment = sanitized.slice(0, SEGMENT_LIMIT).replace(/_+$/u, "");

  if (segment === sanitized && sanitized === remoteName && segment !== "") {
    return `${handle}_${segment}`;
  }

  const suffix = digestOf(remoteName, SUFFIX_LENGTH);

  return segment === "" ? `${handle}_${suffix}` : `${handle}_${segment}_${suffix}`;
}

/**
 * Guard: the prefix is what tells a name this platform minted from a local
 * reader tool. A tombstone registered under a local name would shadow the real
 * tool and make it unrunnable, so only names of this shape are ever stubbed.
 *
 * @param name the tool name as it appears in a conversation's history
 * @returns whether it has the shape `exposedToolNameFor` produces
 */
export function looksExposed(name: string): boolean {
  return /^i[0-9a-f]{8}_/u.test(name);
}

export interface NamedRemoteTool {
  readonly integrationPublicId: string;
  readonly remoteName: string;
}

export interface ToolNameResolution<T extends NamedRemoteTool> {
  readonly byExposedName: ReadonlyMap<ExposedToolName, T>;
  readonly conflicts: readonly T[];
}

/**
 * Indexes a reader's tools by the name the model will use.
 *
 * Guard: a collision is refused, never disambiguated with a counter. A counter
 * depends on the order the rows came back and would renumber silently between
 * turns, which is the one failure the derivation exists to avoid. The caller
 * logs what it dropped.
 *
 * @param tools every tool of every integration the reader has connected
 * @returns the lookup the model's tool name is resolved through, and what it could not place
 */
export function resolveToolNames<T extends NamedRemoteTool>(
  tools: Iterable<T>,
): ToolNameResolution<T> {
  const byExposedName = new Map<ExposedToolName, T>();
  const conflicts: T[] = [];

  for (const entry of tools) {
    const exposed = exposedToolNameFor(entry.integrationPublicId, entry.remoteName);
    if (byExposedName.has(exposed)) {
      conflicts.push(entry);
      continue;
    }

    byExposedName.set(exposed, entry);
  }

  return { byExposedName, conflicts };
}
