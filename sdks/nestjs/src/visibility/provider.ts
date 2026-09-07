import {
  evaluateVisibility,
  SingleFlight,
  type CacheKey,
  type CallerFacts,
  type CallerScope,
  type SkMcpCache,
  type VisibilityDecision,
} from "@sk-mcp/core";
import type { CatalogEntry } from "../catalog.js";
import type { OuterRequest, SkMcpOptions } from "../options.js";
import type { ProbeEvaluator } from "./probe.js";
import type { VisibilityEvaluator } from "./evaluator.js";

export class CallerVisibilityProvider {
  private readonly factsFlight = new SingleFlight<string, CallerFacts>();
  private readonly probeFlight = new SingleFlight<string, VisibilityDecision>();
  private epoch = 0;

  constructor(
    private readonly evaluator: VisibilityEvaluator,
    private readonly prober: ProbeEvaluator,
    private readonly cache: SkMcpCache,
    private readonly options: SkMcpOptions,
  ) {}

  bump(): void {
    this.epoch += 1;
  }

  canProbe(entry: CatalogEntry): boolean {
    return this.prober.canProbe(entry);
  }

  async facts(
    scope: CallerScope,
    outer: OuterRequest | undefined,
    policyNames: ReadonlySet<string>,
  ): Promise<CallerFacts> {
    if (this.options.cache.lifetimeMs <= 0) {
      return this.evaluator.resolve(outer, policyNames);
    }
    const key: CacheKey = { scope, kind: "facts" };
    const observed = this.epoch;
    const cached = await this.read(key);
    if (cached !== undefined) {
      return decodeFacts(cached);
    }
    const resolved = await this.factsFlight.run(String(scope.key), () =>
      this.evaluator.resolve(outer, policyNames),
    );
    if (observed === this.epoch) {
      await this.write(key, encodeFacts(resolved));
    }
    return resolved;
  }

  async probe(
    scope: CallerScope,
    entry: CatalogEntry,
    outer: OuterRequest | undefined,
  ): Promise<VisibilityDecision> {
    const key: CacheKey = { scope, kind: "probe", subkey: entry.tool.name };
    if (this.options.cache.lifetimeMs <= 0) {
      return this.prober.probe(entry, outer);
    }
    const observed = this.epoch;
    const cached = await this.read(key);
    if (cached === "A") {
      return "allow";
    }
    if (cached === "D") {
      return "deny";
    }
    const decision = await this.probeFlight.run(
      `${scope.key}:${entry.tool.name}`,
      () => this.prober.probe(entry, outer),
    );
    if (decision !== "unknown" && observed === this.epoch) {
      await this.write(key, decision === "allow" ? "A" : "D");
    }
    return decision;
  }

  decide(
    auth: CatalogEntry["descriptor"]["auth"],
    facts: CallerFacts,
  ): VisibilityDecision {
    return evaluateVisibility(auth, facts);
  }

  visible(decision: VisibilityDecision): boolean {
    if (decision === "allow") {
      return true;
    }
    if (decision === "deny") {
      return false;
    }
    return this.options.visibility.onUnknown === "show";
  }

  private async read(key: CacheKey): Promise<string | undefined> {
    try {
      return await this.cache.get(key);
    } catch {
      return undefined;
    }
  }

  private async write(key: CacheKey, value: string): Promise<void> {
    try {
      await this.cache.set(key, value);
    } catch {
      return;
    }
  }
}

function encodeFacts(facts: CallerFacts): string {
  const identity =
    facts.identity === "present"
      ? "P"
      : facts.identity === "absent"
        ? "A"
        : "U";
  const results = Object.entries(facts.policyResults ?? {})
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, decision]) => `${name}=${decision.charAt(0).toUpperCase()}`)
    .join(";");
  return `${identity}|${results}`;
}

function decodeFacts(encoded: string): CallerFacts {
  const [identityCode, results = ""] = encoded.split("|");
  const identity =
    identityCode === "P"
      ? "present"
      : identityCode === "A"
        ? "absent"
        : "unknown";
  const policyResults: Record<string, VisibilityDecision> = {};
  for (const pair of results.split(";")) {
    if (pair.length === 0) {
      continue;
    }
    const [name, code] = pair.split("=");
    if (name === undefined || code === undefined) {
      continue;
    }
    policyResults[name] =
      code === "A" ? "allow" : code === "D" ? "deny" : "unknown";
  }
  return { identity, policyResults };
}
