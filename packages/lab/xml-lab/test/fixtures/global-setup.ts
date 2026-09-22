import { rm } from "node:fs/promises";
import type { TestProject } from "vitest/node";
import { buildCorpus, type FixtureCorpus } from "../../src/fixtures/build.js";

declare module "vitest" {
  interface ProvidedContext {
    corpus: FixtureCorpus;
  }
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const corpus = await buildCorpus();
  project.provide("corpus", corpus);
  return async () => {
    await rm(corpus.root, { recursive: true, force: true });
  };
}
