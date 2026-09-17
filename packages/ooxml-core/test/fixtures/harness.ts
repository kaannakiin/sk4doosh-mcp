import { expect } from "vitest";
import {
  createOoxmlReader,
  type OoxmlErrorCode,
  type OoxmlReader,
} from "../../src/index.js";

export class TestError extends Error {
  constructor(
    readonly code: OoxmlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TestError";
  }
}

export function reader(
  limits?: Parameters<typeof createOoxmlReader>[0]["limits"],
): OoxmlReader {
  return createOoxmlReader({
    fail: (code, message) => new TestError(code, message),
    ...(limits === undefined ? {} : { limits }),
  });
}

export function refusalOf(run: () => unknown): TestError {
  try {
    run();
  } catch (error) {
    if (error instanceof TestError) return error;
    throw error;
  }
  throw new Error("expected a refusal, the call returned");
}

export function expectRefusal(
  run: () => unknown,
  code: OoxmlErrorCode,
): TestError {
  const error = refusalOf(run);
  expect(error.code, error.message).toBe(code);
  return error;
}
