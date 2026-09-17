import { CODEX_TOOL_NAMES } from "@chat/contracts/tools/tool-name";
import { describe, expect, it } from "vitest";

import { approvalFor } from "../src/mcp/tool-approval.ts";

const reason = (key: string): string => key;

describe("approvalFor", () => {
  it("asks the reader before a coding agent runs", () => {
    for (const toolName of CODEX_TOOL_NAMES) {
      expect(approvalFor({ toolName, dynamic: false }, reason)).toEqual({
        type: "user-approval",
        reason: `chat:approval.reasons.${toolName}`,
      });
    }
  });

  it("denies a tool outside the product's own vocabulary", () => {
    expect(approvalFor({ toolName: "rm_rf", dynamic: false }, reason)).toEqual({
      type: "denied",
      reason: "chat:approval.denied_unknown",
    });
  });

  it("denies a dynamically discovered tool", () => {
    expect(
      approvalFor({ toolName: "read_sheet", dynamic: true }, reason),
    ).toEqual({
      type: "denied",
      reason: "chat:approval.denied_unknown",
    });
  });

  it("auto-approves only the two structure readers", () => {
    expect(
      approvalFor({ toolName: "describe_workbook", dynamic: false }, reason),
    ).toBe("not-applicable");
    expect(
      approvalFor({ toolName: "describe_document", dynamic: false }, reason),
    ).toBe("not-applicable");
    expect(
      approvalFor({ toolName: "read_sheet", dynamic: false }, reason),
    ).toEqual({
      type: "user-approval",
      reason: "chat:approval.reasons.read_sheet",
    });
  });
});
