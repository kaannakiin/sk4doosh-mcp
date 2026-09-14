import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { RateLimitTrackerService } from "../src/redis/rate-limit-tracker.service.ts";

const secret = Buffer.alloc(32, 9).toString("base64");

async function createTracker(): Promise<RateLimitTrackerService> {
  const module = await Test.createTestingModule({
    providers: [
      RateLimitTrackerService,
      {
        provide: ConfigService,
        useValue: {
          get: (path: string) => (path === "auth.secret" ? secret : undefined),
        },
      },
    ],
  }).compile();

  return module.get(RateLimitTrackerService);
}

describe("RateLimitTrackerService", () => {
  it("creates stable, non-reversible network trackers", async () => {
    const tracker = await createTracker();
    const first = tracker.network({ ip: "203.0.113.4" });
    const second = tracker.network({ ip: "203.0.113.4" });
    const other = tracker.network({ ip: "203.0.113.5" });

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).not.toContain("203.0.113.4");
  });

  it("normalizes email targets across IP addresses", async () => {
    const tracker = await createTracker();
    const first = tracker.subject({
      ip: "203.0.113.4",
      body: { email: "  KAAN@EXAMPLE.COM " },
    });
    const second = tracker.subject({
      ip: "203.0.113.5",
      body: { email: "kaan@example.com" },
    });

    expect(first).toBe(second);
    expect(first).not.toContain("kaan@example.com");
  });

  it("uses opaque auth cookies as subjects without exposing their value", async () => {
    const tracker = await createTracker();
    const subject = tracker.subject({
      cookies: { chat_refresh: "opaque-refresh-token" },
    });

    expect(subject).toMatch(/^refresh:/u);
    expect(subject).not.toContain("opaque-refresh-token");
    expect(tracker.subject({ body: {} })).toBeUndefined();
  });
});
