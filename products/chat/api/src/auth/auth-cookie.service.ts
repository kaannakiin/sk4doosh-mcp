import {
  WEB_ACCESS_TTL_MS,
  WEB_REFRESH_TTL_MS,
} from "@chat/contracts/auth/auth";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";

import { stringProperty } from "../common/utils/object.utils.ts";
import type { AppConfig } from "../config/configuration.ts";
import type { SessionGrant } from "./auth.types.ts";

export const ACCESS_COOKIE_NAME = "chat_access";
export const REFRESH_COOKIE_NAME = "chat_refresh";
export const OAUTH_STATE_COOKIE_NAME = "chat_oauth";
export const OAUTH_PENDING_COOKIE_NAME = "chat_oauth_pending";

@Injectable()
export class AuthCookieService {
  private readonly secure: boolean;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig, true>) {
    const auth = config.get("auth", { infer: true });
    this.secure = auth.cookieSecure;
  }

  issue(response: Response, grant: SessionGrant): void {
    response.cookie(ACCESS_COOKIE_NAME, grant.accessToken, {
      ...this.base(),
      path: "/",
      maxAge: WEB_ACCESS_TTL_MS,
    });
    response.cookie(REFRESH_COOKIE_NAME, grant.refreshToken, {
      ...this.base(),
      path: "/auth",
      maxAge: WEB_REFRESH_TTL_MS,
    });
  }

  setOAuthState(response: Response, token: string): void {
    response.cookie(OAUTH_STATE_COOKIE_NAME, token, {
      ...this.base(),
      path: "/auth/oauth",
      maxAge: 10 * 60 * 1000,
    });
  }

  setOAuthPending(response: Response, token: string): void {
    response.cookie(OAUTH_PENDING_COOKIE_NAME, token, {
      ...this.base(),
      path: "/auth",
      maxAge: 10 * 60 * 1000,
    });
  }

  clearOAuthState(response: Response): void {
    response.clearCookie(OAUTH_STATE_COOKIE_NAME, {
      ...this.base(),
      path: "/auth/oauth",
    });
  }

  clearOAuthPending(response: Response): void {
    response.clearCookie(OAUTH_PENDING_COOKIE_NAME, {
      ...this.base(),
      path: "/auth",
    });
  }

  clearAuth(response: Response): void {
    response.clearCookie(ACCESS_COOKIE_NAME, { ...this.base(), path: "/" });
    response.clearCookie(REFRESH_COOKIE_NAME, {
      ...this.base(),
      path: "/auth",
    });
  }

  access(request: Request): string | undefined {
    return this.read(request, ACCESS_COOKIE_NAME);
  }

  refresh(request: Request): string | undefined {
    return this.read(request, REFRESH_COOKIE_NAME);
  }

  oauthState(request: Request): string | undefined {
    return this.read(request, OAUTH_STATE_COOKIE_NAME);
  }

  oauthPending(request: Request): string | undefined {
    return this.read(request, OAUTH_PENDING_COOKIE_NAME);
  }

  private read(request: Request, name: string): string | undefined {
    return stringProperty(request.cookies, name);
  }

  private base() {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: this.secure,
    };
  }
}
