import { describe, expect, it } from "vitest";

import {
  decideToolApproval,
  grantCanApply,
  toolPosture,
  type ToolPostureRequest,
} from "../src/tools/approval-decision.ts";
import {
  CHAT_TOOL_POLICY,
  toolApprovalPolicySchema,
} from "../src/tools/approval-policy.ts";
import { grantExpiryFor } from "../src/integration/grant-scope.ts";
import { CHAT_TOOL_DEFINITIONS } from "../src/tools/tool-fingerprint.ts";
import { chatToolNameSchema } from "../src/tools/tool-name.ts";

const DIGEST = "a".repeat(64);
const OTHER = "b".repeat(64);
const NOW = new Date("2026-09-17T12:00:00.000Z");

const base = {
  policy: "askable",
  mode: "remember",
  override: undefined,
  destructive: false,
  currentDigest: DIGEST,
  grants: [],
  now: NOW,
} as const;

describe("decideToolApproval", () => {
  it("lets an auto tool run without consulting anything", () => {
    expect(
      decideToolApproval({ ...base, policy: "auto", destructive: true }),
    ).toEqual({ outcome: "allow", reason: "policy_auto" });
  });

  it("asks for an always tool no matter what was remembered", () => {
    expect(
      decideToolApproval({
        ...base,
        policy: "always",
        grants: [{ digest: DIGEST, expiresAt: undefined }],
      }),
    ).toEqual({ outcome: "ask", reason: "policy_always" });
  });

  it("asks for a declared destructive tool even when remembered", () => {
    expect(
      decideToolApproval({
        ...base,
        destructive: true,
        grants: [{ digest: DIGEST, expiresAt: undefined }],
      }),
    ).toEqual({ outcome: "ask", reason: "declared_destructive" });
  });

  it("asks for everything in always_ask, keeping the memory", () => {
    expect(
      decideToolApproval({
        ...base,
        mode: "always_ask",
        grants: [{ digest: DIGEST, expiresAt: undefined }],
      }),
    ).toEqual({ outcome: "ask", reason: "mode_always_ask" });
  });

  it("asks for a tool it has never seen", () => {
    expect(decideToolApproval(base)).toEqual({
      outcome: "ask",
      reason: "not_remembered",
    });
  });

  it("allows a remembered tool whose definition still matches", () => {
    expect(
      decideToolApproval({
        ...base,
        grants: [{ digest: DIGEST, expiresAt: undefined }],
      }),
    ).toEqual({ outcome: "allow", reason: "remembered" });
  });

  it("asks again when the definition changed", () => {
    expect(
      decideToolApproval({
        ...base,
        grants: [{ digest: OTHER, expiresAt: undefined }],
      }),
    ).toEqual({ outcome: "ask", reason: "definition_changed" });
  });

  it("separates a lapsed grant from one that was never given", () => {
    expect(
      decideToolApproval({
        ...base,
        grants: [{ digest: DIGEST, expiresAt: new Date(NOW.getTime() - 1000) }],
      }),
    ).toEqual({ outcome: "ask", reason: "grant_expired" });
  });

  it("honours a grant that is still live", () => {
    expect(
      decideToolApproval({
        ...base,
        grants: [{ digest: DIGEST, expiresAt: new Date(NOW.getTime() + 1000) }],
      }),
    ).toEqual({ outcome: "allow", reason: "remembered" });
  });

  /**
   * A subject can hold an everywhere grant and a conversation-scoped one at the
   * same time. The narrow one is typically the newer, given after the definition
   * changed, so ranking the two by scope would let the stale row decide.
   */
  it("consults every live grant rather than ranking them", () => {
    expect(
      decideToolApproval({
        ...base,
        grants: [
          { digest: OTHER, expiresAt: undefined },
          { digest: DIGEST, expiresAt: undefined },
        ],
      }),
    ).toEqual({ outcome: "allow", reason: "remembered" });
  });

  it("runs everything unasked in auto, except what the server calls destructive", () => {
    expect(decideToolApproval({ ...base, mode: "auto" })).toEqual({
      outcome: "allow",
      reason: "mode_auto",
    });
    expect(
      decideToolApproval({ ...base, mode: "auto", destructive: true }),
    ).toEqual({ outcome: "ask", reason: "declared_destructive" });
  });

  it("lets an always_ask override silence nothing and outrank a grant", () => {
    expect(
      decideToolApproval({
        ...base,
        mode: "auto",
        override: { mode: "always_ask", digest: undefined },
        grants: [{ digest: DIGEST, expiresAt: undefined }],
      }),
    ).toEqual({ outcome: "ask", reason: "override_always_ask" });
  });

  it("lets an auto override run a destructive tool it was given for", () => {
    expect(
      decideToolApproval({
        ...base,
        mode: "always_ask",
        destructive: true,
        override: { mode: "auto", digest: DIGEST },
      }),
    ).toEqual({ outcome: "allow", reason: "override_auto" });
  });

  it("asks again when an auto override's definition changed", () => {
    expect(
      decideToolApproval({
        ...base,
        override: { mode: "auto", digest: OTHER },
      }),
    ).toEqual({ outcome: "ask", reason: "definition_changed" });
  });

  it("never lets an override loosen a tool the product always asks about", () => {
    expect(
      decideToolApproval({
        ...base,
        policy: "always",
        override: { mode: "auto", digest: DIGEST },
      }),
    ).toEqual({ outcome: "ask", reason: "policy_always" });
  });

  it("ignores an expired grant when deciding the digest matched", () => {
    expect(
      decideToolApproval({
        ...base,
        grants: [
          { digest: DIGEST, expiresAt: new Date(NOW.getTime() - 1000) },
          { digest: OTHER, expiresAt: undefined },
        ],
      }),
    ).toEqual({ outcome: "ask", reason: "definition_changed" });
  });
});

describe("grantCanApply", () => {
  it("offers to remember only where a grant is what decides", () => {
    expect(grantCanApply(base)).toBe(true);
    expect(grantCanApply({ ...base, mode: "always_ask" })).toBe(false);
    expect(grantCanApply({ ...base, mode: "auto" })).toBe(false);
    expect(grantCanApply({ ...base, destructive: true })).toBe(false);
    expect(grantCanApply({ ...base, policy: "always" })).toBe(false);
    expect(
      grantCanApply({
        ...base,
        override: { mode: "always_ask", digest: undefined },
      }),
    ).toBe(false);
  });
});

describe("toolPosture", () => {
  const posture = {
    override: "inherit",
    overrideStale: false,
    destructive: false,
    integrationMode: "inherit",
    readerMode: "remember",
  } as const;

  it("reads the reader's mode when the integration inherits", () => {
    expect(toolPosture(posture)).toEqual({
      posture: "grants",
      source: "reader",
    });
  });

  it("prefers the integration's mode over the reader's", () => {
    expect(toolPosture({ ...posture, integrationMode: "auto" })).toEqual({
      posture: "allow",
      source: "integration",
    });
  });

  it("asks for a destructive tool whatever the integration trusts", () => {
    expect(
      toolPosture({ ...posture, destructive: true, integrationMode: "auto" }),
    ).toEqual({ posture: "ask", source: "declared_destructive" });
  });

  it("lets an auto override outrank the destructive hint", () => {
    expect(
      toolPosture({ ...posture, destructive: true, override: "auto" }),
    ).toEqual({ posture: "allow", source: "override" });
  });

  it("asks again once an auto override has gone stale", () => {
    expect(
      toolPosture({ ...posture, override: "auto", overrideStale: true }),
    ).toEqual({ posture: "ask", source: "definition_changed" });
  });

  it("agrees with the gate for every combination of settings", () => {
    const overrides = ["inherit", "always_ask", "auto"] as const;
    const integrationModes = [
      "inherit",
      "always_ask",
      "remember",
      "auto",
    ] as const;
    const readerModes = ["always_ask", "remember"] as const;
    const flags = [false, true] as const;

    for (const override of overrides) {
      for (const integrationMode of integrationModes) {
        for (const readerMode of readerModes) {
          for (const destructive of flags) {
            for (const overrideStale of flags) {
              const request: ToolPostureRequest = {
                override,
                overrideStale,
                destructive,
                integrationMode,
                readerMode,
              };
              const gate = (remembered: boolean) =>
                decideToolApproval({
                  ...base,
                  mode:
                    integrationMode === "inherit"
                      ? readerMode
                      : integrationMode,
                  override:
                    override === "inherit"
                      ? undefined
                      : {
                          mode: override,
                          digest: overrideStale ? OTHER : DIGEST,
                        },
                  destructive,
                  grants: remembered
                    ? [{ digest: DIGEST, expiresAt: undefined }]
                    : [],
                }).outcome;
              const expected = {
                ask: ["ask", "ask"],
                grants: ["ask", "allow"],
                allow: ["allow", "allow"],
              }[toolPosture(request).posture];

              expect(
                [gate(false), gate(true)],
                JSON.stringify(request),
              ).toEqual(expected);
            }
          }
        }
      }
    }
  });
});

describe("CHAT_TOOL_POLICY", () => {
  it("declares a posture for every tool this product ships", () => {
    for (const name of chatToolNameSchema.options) {
      expect(toolApprovalPolicySchema.parse(CHAT_TOOL_POLICY[name])).toBe(
        CHAT_TOOL_POLICY[name],
      );
    }
  });

  /**
   * Remembering `codex_task` would make the gate answer `approved`, which runs
   * it inline inside a step where the chunk watchdog kills it at a minute.
   */
  it("keeps the coding agent unrememberable", () => {
    expect(CHAT_TOOL_POLICY.codex_task).toBe("always");
  });

  it("stops asking about the tool search", () => {
    expect(CHAT_TOOL_POLICY.find_tools).toBe("auto");
  });
});

describe("CHAT_TOOL_DEFINITIONS", () => {
  it("fingerprints every tool", () => {
    for (const name of chatToolNameSchema.options) {
      expect(CHAT_TOOL_DEFINITIONS[name]).toBeDefined();
    }
  });

  /**
   * The tool's own description is read out of the locale files at call time, so
   * a fingerprint that carried it would change with the reader's language and
   * drop every grant they had given.
   */
  it("carries no localized prose", () => {
    const serialized = JSON.stringify(CHAT_TOOL_DEFINITIONS.codex_task);

    expect(serialized).toContain("sandboxed directory");
    expect(serialized).not.toContain("Delegate a coding");
  });
});

describe("grantExpiryFor", () => {
  it("never lapses when the reader asked for never", () => {
    expect(grantExpiryFor("never", NOW)).toBeUndefined();
  });

  it("lapses a day and a week out", () => {
    expect(grantExpiryFor("day", NOW)?.toISOString()).toBe(
      "2026-09-18T12:00:00.000Z",
    );
    expect(grantExpiryFor("week", NOW)?.toISOString()).toBe(
      "2026-09-24T12:00:00.000Z",
    );
  });
});
