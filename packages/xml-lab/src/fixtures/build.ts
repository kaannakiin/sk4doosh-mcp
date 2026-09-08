import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureCorpus {
  readonly root: string;
}

export async function buildCorpus(): Promise<FixtureCorpus> {
  const root = await mkdtemp(join(tmpdir(), "sk-mcp-xml-f0-"));
  return { root };
}
