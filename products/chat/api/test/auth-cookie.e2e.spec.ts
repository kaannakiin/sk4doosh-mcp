import { WEB_REFRESH_TTL_MS } from "@chat/contracts/auth/auth";
import type { UserId } from "@chat/db";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACCESS_COOKIE_NAME,
  AuthCookieService,
  REFRESH_COOKIE_NAME,
} from "../src/auth/auth-cookie.service.ts";
import type { SessionGrant } from "../src/auth/auth.types.ts";

const authConfig = {
  cookieSecure: false,
};

const grant: SessionGrant = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  response: {
    user: {
      id: "01994cf1-dbbc-7a38-9282-0a1083ed4a2f",
      firstName: "Kaan",
      lastName: "Akın",
      email: "kaan@example.com",
      phoneE164: null,
      emailVerified: true,
      phoneVerified: false,
      providers: [],
      createdAt: new Date().toISOString(),
    },
  },
  session: {
    publicId: "01994cf1-dbbc-7a38-9282-0a1083ed4a30",
    expiresAt: new Date(Date.now() + WEB_REFRESH_TTL_MS),
    revokedAt: null,
    user: {
      internalId: "1" as UserId,
      publicId: "01994cf1-dbbc-7a38-9282-0a1083ed4a2f",
      firstName: "Kaan",
      lastName: "Akın",
      email: "kaan@example.com",
      phoneE164: null,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      disabledAt: null,
      createdAt: new Date(),
      providers: [],
    },
  },
};

describe("auth cookies", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthCookieService,
        {
          provide: ConfigService,
          useValue: { get: () => authConfig },
        },
      ],
    }).compile();
    const cookies = module.get(AuthCookieService);
    app = module.createNestApplication();
    app.use("/issue", (_request: Request, response: Response) => {
      cookies.issue(response, grant);
      response.sendStatus(204);
    });
    await app.init();
  });

  afterAll(async () => app.close());

  it("issues access and refresh tokens only as scoped HttpOnly cookies", async () => {
    const response = await request(app.getHttpServer()).get("/issue").expect(204);
    const headers = response.headers["set-cookie"];

    expect(Array.isArray(headers)).toBe(true);
    const cookies = Array.isArray(headers) ? headers : [];
    const access = cookies.find((cookie) => cookie.startsWith(`${ACCESS_COOKIE_NAME}=`));
    const refresh = cookies.find((cookie) =>
      cookie.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );

    expect(access).toContain("HttpOnly");
    expect(access).toContain("SameSite=Lax");
    expect(access).toContain("Path=/");
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("SameSite=Lax");
    expect(refresh).toContain("Path=/auth");
    expect(cookies.join(";")).not.toContain("Secure");
  });
});
