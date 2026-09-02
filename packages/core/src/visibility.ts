import type { Auth } from "./generated/endpoint-descriptor.js";

export type VisibilityDecision = "allow" | "deny" | "unknown";

export type CallerIdentity = "present" | "absent" | "unknown";

export interface CallerFacts {
  readonly identity: CallerIdentity;
  readonly policyResults?: Readonly<Record<string, VisibilityDecision>>;
}

export function evaluateVisibility(auth: Auth, caller: CallerFacts): VisibilityDecision {
  if (!auth.anonymous && caller.identity === "absent") {
    return "deny";
  }
  const results = caller.policyResults ?? {};
  if (auth.policies.some((policy) => results[policy] === "deny")) {
    return "deny";
  }
  if (auth.imperative) {
    return "unknown";
  }
  if (!auth.anonymous && caller.identity === "unknown") {
    return "unknown";
  }
  if (auth.policies.some((policy) => results[policy] !== "allow")) {
    return "unknown";
  }
  return "allow";
}
