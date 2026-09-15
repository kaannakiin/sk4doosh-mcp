import { HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  HTTP_STATUS_BY_CONNECTION_ERROR,
  type ConnectionErrorCode,
} from "../src/connections/connection-errors.ts";
import enHttp from "../src/i18n/locales/en/http.json" with { type: "json" };
import trHttp from "../src/i18n/locales/tr/http.json" with { type: "json" };

/**
 * Guard: `check-types` runs `tsc` over this file, so a connection error code
 * added without a translation fails the build rather than the suite.
 */
enHttp satisfies Record<ConnectionErrorCode, string>;

trHttp satisfies Record<ConnectionErrorCode, string>;

describe("connection error codes", () => {
  it("has an English and a Turkish message for every connection error code", () => {
    for (const code of Object.keys(HTTP_STATUS_BY_CONNECTION_ERROR)) {
      expect(enHttp).toHaveProperty(code);
      expect(trHttp).toHaveProperty(code);
    }
  });

  it("answers 403 for every denial the authorizer can produce", () => {
    const { provider_unavailable, ...denials } =
      HTTP_STATUS_BY_CONNECTION_ERROR;

    expect(Object.values(denials)).toEqual(
      Object.values(denials).map(() => HttpStatus.FORBIDDEN),
    );
    expect(provider_unavailable).toBe(HttpStatus.BAD_GATEWAY);
  });
});
