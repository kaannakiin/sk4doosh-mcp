import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";

import { rankByTerms } from "../src/chat/tool-search.ts";
import type { AppConfig } from "../src/config/configuration.ts";
import type { UserId } from "../src/db/ids.ts";
import { ApprovalHolds } from "../src/gateway/approval-holds.ts";
import type { GatewayTurn } from "../src/gateway/gateway-turn.ts";
import { GrantRegistry } from "../src/gateway/grant-registry.ts";
import { Lane } from "../src/gateway/worker-lane.ts";

const READER = "1" as UserId;
const STRANGER = "2" as UserId;

function config(approvalHoldMs: number): ConfigService<AppConfig, true> {
  return {
    get: () => ({ approvalHoldMs, workerConcurrency: 1 }),
  } as unknown as ConfigService<AppConfig, true>;
}

const TURN = { locale: "en" } as GatewayTurn;

describe("GrantRegistry", () => {
  it("resolves an open grant and nothing once it is closed", () => {
    const grants = new GrantRegistry();
    const token = grants.open(TURN, Date.now() + 60_000);

    expect(grants.turnFor(token)).toBe(TURN);
    grants.close(token);
    expect(grants.turnFor(token)).toBeUndefined();
  });

  it("refuses a grant past its expiry even if its turn never closed it", () => {
    const grants = new GrantRegistry();
    const token = grants.open(TURN, Date.now() - 1);

    expect(grants.turnFor(token)).toBeUndefined();
  });

  it("knows no token it did not issue", () => {
    expect(new GrantRegistry().turnFor("guess")).toBeUndefined();
  });
});

describe("ApprovalHolds", () => {
  it("settles with the reader's answer", async () => {
    const holds = new ApprovalHolds(config(60_000));
    const hold = holds.hold(READER, new AbortController().signal);

    expect(
      holds.answer(READER, hold.approvalId, {
        approved: true,
        remembered: true,
      }),
    ).toBe(true);
    await expect(hold.outcome).resolves.toEqual({
      status: "approved",
      remembered: true,
    });
  });

  it("does not let another reader answer, and says so as if it were gone", async () => {
    const holds = new ApprovalHolds(config(20));
    const hold = holds.hold(READER, new AbortController().signal);

    expect(
      holds.answer(STRANGER, hold.approvalId, {
        approved: true,
        remembered: false,
      }),
    ).toBe(false);
    await expect(hold.outcome).resolves.toEqual({ status: "expired" });
  });

  it("expires when nobody answers, and a late answer changes nothing", async () => {
    const holds = new ApprovalHolds(config(10));
    const hold = holds.hold(READER, new AbortController().signal);

    await expect(hold.outcome).resolves.toEqual({ status: "expired" });
    expect(
      holds.answer(READER, hold.approvalId, {
        approved: true,
        remembered: false,
      }),
    ).toBe(false);
  });

  it("expires when the turn ends first", async () => {
    const holds = new ApprovalHolds(config(60_000));
    const turn = new AbortController();
    const hold = holds.hold(READER, turn.signal);
    turn.abort();

    await expect(hold.outcome).resolves.toEqual({ status: "expired" });
  });
});

describe("rankByTerms", () => {
  const entries = [
    { name: "read_sheet", text: "read_sheet workbook rows of a sheet" },
    { name: "aggregate_sheet", text: "aggregate_sheet workbook sum a column" },
    { name: "read_pdf_pages", text: "read_pdf_pages pdf text of pages" },
  ];

  it("ranks by how many terms an entry holds and drops the rest", () => {
    expect(
      rankByTerms(entries, "sum workbook column", (entry) => entry.text).map(
        (entry) => entry.name,
      ),
    ).toEqual(["aggregate_sheet", "read_sheet"]);
  });

  it("finds nothing for a query no entry holds", () => {
    expect(rankByTerms(entries, "invoice", (entry) => entry.text)).toEqual([]);
  });
});

describe("Lane", () => {
  it("runs one task at a time, in arrival order", async () => {
    const lane = new Lane(1);
    const order: string[] = [];
    let release: () => void = () => undefined;
    const first = lane.run(new AbortController().signal, async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("first:end");
    });
    const second = lane.run(new AbortController().signal, () => {
      order.push("second");

      return Promise.resolve();
    });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("drops a waiter whose turn was cancelled without running it", async () => {
    const lane = new Lane(1);
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const busy = lane.run(
      new AbortController().signal,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          started();
        }),
    );
    await running;

    const cancelled = new AbortController();
    let ran = false;
    const waiting = lane
      .run(cancelled.signal, () => {
        ran = true;

        return Promise.resolve();
      })
      .then(
        () => "ran",
        () => "rejected",
      );
    cancelled.abort();
    release();
    await busy;

    await expect(waiting).resolves.toBe("rejected");
    expect(ran).toBe(false);
  });
});
