import type { CallerFacts } from "@sk-mcp/core";
import type { OuterRequest } from "../options.js";

export interface VisibilityEvaluator {
  resolve(
    outer: OuterRequest | undefined,
    policyNames: ReadonlySet<string>,
  ): Promise<CallerFacts>;
}

export class DeclarativeVisibilityEvaluator implements VisibilityEvaluator {
  resolve(): Promise<CallerFacts> {
    return Promise.resolve({ identity: "unknown" });
  }
}
