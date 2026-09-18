import "reflect-metadata";
import type { ServerResponse } from "node:http";
import { Controller, Get, Res } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SkMcpDispatcher,
  SkMcpDispatchAborted,
  SkMcpModule,
  SkMcpOptions,
} from "../src/index.js";

@Controller()
class HangController {
  @Get("hang")
  hang(@Res() _res: ServerResponse) {
    return undefined;
  }

  @Get("late")
  late(@Res() res: ServerResponse) {
    setTimeout(() => {
      res.end(JSON.stringify({ late: true }));
    }, 60);
    return undefined;
  }
}

let app: Awaited<ReturnType<typeof createHangApp>>;

async function createHangApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [SkMcpModule.forRoot()],
    controllers: [HangController],
  }).compile();
  const nest = moduleRef.createNestApplication({ logger: false });
  await nest.init();
  return {
    dispatcher: nest.get(SkMcpDispatcher),
    close: () => nest.close(),
  };
}

beforeEach(async () => {
  app = await createHangApp();
});

afterEach(async () => {
  await app.close();
});

describe("dispatch abort", () => {
  it("D1 rejects a dispatch whose signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      app.dispatcher.dispatch("GET", "/hang", undefined, {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(SkMcpDispatchAborted);
  });

  it("D2 rejects a handler that never ends the response, instead of hanging forever", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const error = await app.dispatcher
      .dispatch("GET", "/hang", undefined, { signal: controller.signal })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SkMcpDispatchAborted);
    expect((error as SkMcpDispatchAborted).reason).toBe("caller");
  });

  it("D3 delivers a disconnect to the abandoned handler", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const original = app.dispatcher["adapterHost"] as HttpAdapterHost;
    const pipeline =
      original.httpAdapter.getInstance<(req: unknown, res: unknown) => void>();
    const spy = (req: unknown, res: unknown): void => {
      (req as NodeJS.EventEmitter).on("aborted", () => seen.push("aborted"));
      (req as NodeJS.EventEmitter).on("close", () => seen.push("req:close"));
      (res as NodeJS.EventEmitter).on("close", () => seen.push("res:close"));
      pipeline(req, res);
    };
    const patched = new SkMcpDispatcher(
      { httpAdapter: { getInstance: () => spy } } as unknown as HttpAdapterHost,
      new SkMcpOptions(),
    );
    setTimeout(() => controller.abort(), 20);
    await expect(
      patched.dispatch("GET", "/hang", undefined, {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(SkMcpDispatchAborted);
    expect(seen).toEqual(["aborted", "req:close", "res:close"]);
  });

  it("D4 stays settled when an abandoned handler answers later", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const pending = app.dispatcher.dispatch("GET", "/late", undefined, {
      signal: controller.signal,
    });
    await expect(pending).rejects.toBeInstanceOf(SkMcpDispatchAborted);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await expect(pending).rejects.toBeInstanceOf(SkMcpDispatchAborted);
  });

  it("D5 surfaces a pipeline failure as itself, not as an abort", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const broken = new SkMcpDispatcher(
      {
        httpAdapter: {
          getInstance: () => () => {
            throw new Error("pipeline exploded");
          },
        },
      } as unknown as HttpAdapterHost,
      new SkMcpOptions(),
    );
    try {
      await expect(broken.dispatch("GET", "/hang")).rejects.toThrow(
        "pipeline exploded",
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
