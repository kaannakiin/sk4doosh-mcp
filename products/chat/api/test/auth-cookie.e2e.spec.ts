import { WEB_REFRESH_TTL_MS } from "@chat/contracts/auth/auth";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserId } from "../src/db/ids.ts";
import {
  ACCESS_COOKIE_NAME,
  AuthCookieService,
  REFRESH_COOKIE_NAME,
  SESSION_HINT_COOKIE_NAME,
} from "../src/auth/auth-cookie.service.ts";
import type { SessionGrant } from "../src/auth/auth.types.ts";

const PATH_PREFIX = "/api";

interface CookieConfig {
  cookieSecure: boolean;
  cookieSameSite: "lax" | "none";
}

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
      toolApprovalMode: "remember",
      grantTtl: "never",
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
      toolApprovalMode: "remember",
      grantTtl: "never",
      providers: [],
    },
  },
};

async function createApp(auth: CookieConfig): Promise<INestApplication> {
  const config = { auth, pathPrefix: PATH_PREFIX } as const;
  const module = await Test.createTestingModule({
    providers: [
      AuthCookieService,
      {
        provide: ConfigService,
        useValue: { get: (key: keyof typeof config) => config[key] },
      },
    ],
  }).compile();
  const cookies = module.get(AuthCookieService);
  const app = module.createNestApplication();
  app.use("/issue", (_request: Request, response: Response) => {
    cookies.issue(response, grant);
    response.sendStatus(204);
  });
  await app.init();

  return app;
}

async function issued(app: INestApplication): Promise<string[]> {
  const response = await request(app.getHttpServer()).get("/issue").expect(204);
  const headers = response.headers["set-cookie"];

  expect(Array.isArray(headers)).toBe(true);

  return Array.isArray(headers) ? headers : [];
}

describe("auth cookies", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ cookieSecure: false, cookieSameSite: "lax" });
  });

  afterAll(async () => app.close());

  it("scopes the session cookies to paths the browser will actually match", async () => {
    const cookies = await issued(app);
    const access = cookies.find((cookie) =>
      cookie.startsWith(`${ACCESS_COOKIE_NAME}=`),
    );
    const refresh = cookies.find((cookie) =>
      cookie.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );

    expect(access).toContain("HttpOnly");
    expect(access).toContain("SameSite=Lax");
    /**
     * Guard: the access cookie stays at the root because the server-rendered
     * document request goes to a page path, not to the api prefix. Scoping it
     * alongside the refresh cookie makes the render blind to every session.
     */
    expect(access).toContain("Path=/;");
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("SameSite=Lax");
    /**
     * Guard: the refresh path has to sit under the prefix the browser requests.
     * RFC 6265 matches a cookie path against the request path, so `/auth` while
     * the browser asks for `/api/auth/refresh` is stored and never sent — the app
     * then works for one access-token lifetime and dies with no signal.
     */
    expect(refresh).toContain(`Path=${PATH_PREFIX}/auth;`);
    expect(cookies.join(";")).not.toContain("Secure");
  });
});

describe("auth cookies on a separately hosted api", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp({ cookieSecure: true, cookieSameSite: "none" });
  });

  afterAll(async () => app.close());

  /**
   * Guard: all three cookies have to carry it, the readable session marker
   * included. A browser withholds a `SameSite=Lax` cookie from every cross-site
   * request, so one left behind is a session the api issues and never sees
   * again — and `SameSite=None` without `Secure` is discarded outright, which is
   * why the env schema refuses that pairing at startup.
   */
  it("marks every session cookie cross-site and secure", async () => {
    const cookies = await issued(app);

    expect(cookies).toHaveLength(3);
    for (const cookie of cookies) {
      expect(cookie).toContain("SameSite=None");
      expect(cookie).toContain("Secure");
    }
    expect(
      cookies.find((cookie) =>
        cookie.startsWith(`${SESSION_HINT_COOKIE_NAME}=`),
      ),
    ).not.toContain("HttpOnly");
  });
});
