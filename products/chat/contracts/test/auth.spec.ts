import { describe, expect, it } from "vitest";

import {
  authProviderSchema,
  challengeConfirmationSchema,
  emailRegistrationSchema,
  phoneRegistrationSchema,
} from "../src/auth/auth.ts";

describe("auth contracts", () => {
  it("normalizes names and email without modifying the password", () => {
    const password = "  long password  ";
    const result = emailRegistrationSchema.parse({
      firstName: "  Kaan ",
      lastName: " Akın  ",
      email: "  KAAN@EXAMPLE.COM ",
      password,
    });

    expect(result).toEqual({
      firstName: "Kaan",
      lastName: "Akın",
      email: "kaan@example.com",
      password,
    });
  });

  it("enforces password bounds", () => {
    expect(
      emailRegistrationSchema.safeParse({
        firstName: "Kaan",
        lastName: "Akın",
        email: "kaan@example.com",
        password: "short",
      }).success,
    ).toBe(false);
    expect(
      emailRegistrationSchema.safeParse({
        firstName: "Kaan",
        lastName: "Akın",
        email: "kaan@example.com",
        password: "x".repeat(129),
      }).success,
    ).toBe(false);
  });

  it("accepts only E.164 phone numbers and six-digit OTPs", () => {
    expect(
      phoneRegistrationSchema.safeParse({
        firstName: "Kaan",
        lastName: "Akın",
        phoneE164: "+905551112233",
      }).success,
    ).toBe(true);
    expect(
      phoneRegistrationSchema.safeParse({
        firstName: "Kaan",
        lastName: "Akın",
        phoneE164: "05551112233",
      }).success,
    ).toBe(false);
    expect(
      challengeConfirmationSchema.safeParse({
        challengeId: "01994cf1-dbbc-7a38-9282-0a1083ed4a2f",
        code: "012345",
      }).success,
    ).toBe(true);
    expect(
      challengeConfirmationSchema.safeParse({
        challengeId: "01994cf1-dbbc-7a38-9282-0a1083ed4a2f",
        code: "12345a",
      }).success,
    ).toBe(false);
  });

  it("restricts OAuth providers", () => {
    expect(authProviderSchema.safeParse("google").success).toBe(true);
    expect(authProviderSchema.safeParse("github").success).toBe(true);
    expect(authProviderSchema.safeParse("gitlab").success).toBe(false);
  });
});
