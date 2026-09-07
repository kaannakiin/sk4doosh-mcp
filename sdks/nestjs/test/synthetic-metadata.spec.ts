import { afterEach, describe, expect, it } from "vitest";
import { createApp, outer, type TestApp } from "./hosts.js";

let current: TestApp | undefined;

async function start(...args: Parameters<typeof createApp>): Promise<TestApp> {
  current = await createApp(...args);
  return current;
}

afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function meta(
  app: TestApp,
  outerRequest?: Parameters<TestApp["dispatcher"]["dispatch"]>[2],
) {
  const result = await app.dispatcher.dispatch("GET", "/meta", outerRequest);
  expect(result.status).toBe(200);
  return JSON.parse(result.body);
}

describe("synthetic metadata", () => {
  it("M1: host and scheme reflect the outer request", async () => {
    const app = await start();
    const outerRequest = outer({ host: "tenant-a.example.com" }, "https");

    const parts = await meta(app, outerRequest);
    expect(parts.protocol).toBe("https");
    expect(parts.host).toBe("tenant-a.example.com");

    const tenant = await app.dispatcher.dispatch(
      "GET",
      "/tenant",
      outerRequest,
    );
    expect(JSON.parse(tenant.body).tenant).toBe("A");
  });

  it("M2: without an outer request, falls back to http://localhost", async () => {
    const app = await start();
    const parts = await meta(app);
    expect(parts.protocol).toBe("http");
    expect(parts.host).toBe("localhost");
  });

  it("M3: a configured host override beats the outer request", async () => {
    const app = await start((options) => {
      options.synthetic.host = "internal.api";
    });
    const parts = await meta(app, outer({ host: "tenant-a.example.com" }));
    expect(parts.host).toBe("internal.api");
  });

  it("M4: accept defaults to application/json and is overridable", async () => {
    const app = await start();
    expect((await meta(app)).accept).toBe("application/json");
    await app.close();

    const custom = await start((options) => {
      options.synthetic.accept = "application/xml";
    });
    expect((await meta(custom)).accept).toBe("application/xml");
  });

  it("M5: user-agent defaults to sk-mcp/{version} and is overridable", async () => {
    const app = await start();
    expect((await meta(app)).userAgent).toMatch(/^sk-mcp\//);
    await app.close();

    const custom = await start((options) => {
      options.synthetic.userAgent = "acme-agent/2";
    });
    expect((await meta(custom)).userAgent).toBe("acme-agent/2");
  });

  it("M6: trace correlation headers always travel", async () => {
    const app = await start();
    const traceparent =
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const parts = await meta(app, outer({ traceparent }));
    expect(parts.traceparent).toBe(traceparent);
  });

  it("M7: accept-encoding is never forwarded", async () => {
    const app = await start();
    const parts = await meta(app, outer({ "accept-encoding": "gzip, br" }));
    expect(parts.acceptEncoding).toBeNull();
  });
});
