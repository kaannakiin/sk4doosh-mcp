import { rm } from "node:fs/promises";
import type { TestProject } from "vitest/node";
import { buildFixtures, type Fixtures } from "./build.js";

declare module "vitest" {
  interface ProvidedContext {
    fixtures: Fixtures;
  }
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const fixtures = await buildFixtures();
  project.provide("fixtures", fixtures);
  return async () => {
    await rm(fixtures.root, { recursive: true, force: true });
  };
}
