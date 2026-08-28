import { afterEach, describe, expect, it } from "vitest";
import { createApp, mintToken, outer, type TestApp } from "./hosts.js";

let current: TestApp | undefined;

async function start(...args: Parameters<typeof createApp>): Promise<TestApp> {
  current = await createApp(...args);
  return current;
}

afterEach(async () => {
  await current?.close();
  current = undefined;
});

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("identity carriers", () => {
  it("S1: token matrix matches plain HTTP exactly", async () => {
    const { app, dispatcher } = await start();
    await app.listen(0);
    const baseUrl = await app.getUrl();

    const cases: Array<[Record<string, string>, number]> = [
      [bearer(mintToken("alice", ["orders.read"])), 200],
      [bearer(mintToken("bob", [])), 403],
      [{}, 401],
    ];
    for (const [headers, expected] of cases) {
      const http = await fetch(`${baseUrl}/orders/7`, { headers });
      expect(http.status).toBe(expected);
      const dispatched = await dispatcher.dispatch("GET", "/orders/7", outer(headers));
      expect(dispatched.status).toBe(expected);
    }
  });

  it("S2: undeclared carriers are dropped by default", async () => {
    const { dispatcher } = await start();
    const result = await dispatcher.dispatch(
      "GET",
      "/echo-headers",
      outer({ "x-csrf-token": "csrf-1", cookie: "session=abc" }),
    );
    const echo = JSON.parse(result.body);
    expect(echo.csrf).toBeNull();
    expect(echo.cookie).toBeNull();
  });

  it("S3: a declared carrier is forwarded, name case-insensitive", async () => {
    const { dispatcher } = await start((options) => options.identity.forward("X-CSRF-Token"));
    const result = await dispatcher.dispatch("GET", "/echo-headers", outer({ "x-csrf-token": "csrf-1" }));
    expect(JSON.parse(result.body).csrf).toBe("csrf-1");
  });

  it("S4: cookies are headers and forwardable by declaration", async () => {
    const { dispatcher } = await start((options) => options.identity.forward("Cookie"));
    const result = await dispatcher.dispatch("GET", "/echo-headers", outer({ cookie: "session=abc" }));
    expect(JSON.parse(result.body).cookie).toBe("session=abc");
  });

  it("S5: project composes identity with full control", async () => {
    const token = mintToken("projected", ["orders.read"]);
    const { dispatcher } = await start((options) =>
      options.identity.project((outerRequest, synthetic) => {
        if (outerRequest.headers["x-api-key"] === "trusted") {
          synthetic["authorization"] = `Bearer ${token}`;
        }
      }),
    );
    const result = await dispatcher.dispatch("GET", "/me", outer({ "x-api-key": "trusted" }));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).sub).toBe("projected");
  });

  it("S6: a carrier absent on the outer request is never fabricated", async () => {
    const { dispatcher } = await start();
    const result = await dispatcher.dispatch("GET", "/echo-headers", outer({}));
    const echo = JSON.parse(result.body);
    expect(echo.authorization).toBeNull();
    expect(echo.hasAuthorization).toBe(false);
  });

  it("S7: CSRF cookie + header pair travels when both declared", async () => {
    const { dispatcher } = await start((options) =>
      options.identity.forward("Cookie").forward("X-CSRF-Token"),
    );
    const result = await dispatcher.dispatch(
      "GET",
      "/echo-headers",
      outer({ cookie: "session=abc", "x-csrf-token": "csrf-1" }),
    );
    const echo = JSON.parse(result.body);
    expect(echo.cookie).toBe("session=abc");
    expect(echo.csrf).toBe("csrf-1");
  });

  it("S8: an expired token is rejected on every dispatch", async () => {
    const { dispatcher } = await start();
    const expired = mintToken("alice", ["orders.read"], -60);
    const result = await dispatcher.dispatch("GET", "/me", outer(bearer(expired)));
    expect(result.status).toBe(401);
  });

  it("S9: no identity bleed across 50 parallel dispatches", async () => {
    const { dispatcher } = await start();
    const alice = bearer(mintToken("alice", ["orders.read"]));
    const bob = bearer(mintToken("bob", []));
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        dispatcher.dispatch("GET", "/orders/7", outer(i % 2 === 0 ? alice : bob)),
      ),
    );
    results.forEach((result, i) => {
      expect(result.status).toBe(i % 2 === 0 ? 200 : 403);
    });
  });
});
