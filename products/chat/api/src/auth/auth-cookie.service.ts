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
export const SESSION_HINT_COOKIE_NAME = "chat_session";
export const ACCESS_COOKIE_PATH = "/";

@Injectable()
export class AuthCookieService {
  private readonly secure: boolean;
  private readonly sameSite: "lax" | "none";
  private readonly authPath: string;
  private readonly oauthPath: string;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig, true>) {
    const auth = config.get("auth", { infer: true });
    this.secure = auth.cookieSecure;
    /**
     * Guard: `none` is required, not merely preferable, when the api answers on
     * its own site. A `SameSite=Lax` cookie is withheld from every cross-site
     * subresource request including a plain GET, so the browser would hold a
     * perfectly valid session and never send it.
     */
    this.sameSite = auth.cookieSameSite;
    /**
     * Guard: the refresh and oauth paths are derived from the api prefix, never
     * written literally. Narrowing the refresh token to the auth subtree keeps it
     * off every chat request, but a browser matches a cookie path against the url
     * it asks for — under a prefix the literal `/auth` is stored and then never
     * sent, and the app runs for one access-token lifetime before failing with no
     * signal.
     */
    const prefix = config.get("pathPrefix", { infer: true });
    this.authPath = `${prefix}/auth`;
    this.oauthPath = `${this.authPath}/oauth`;
  }

  issue(response: Response, grant: SessionGrant): void {
    /**
     * Guard: the access cookie stays at the origin root while the refresh cookie
     * does not. The web app is server-rendered and its document request goes to a
     * page path, not to the api prefix — scoping this one under the prefix too
     * would leave the render blind to every session and bounce signed-in readers
     * to the sign-in page. The thirty day refresh token is the one worth keeping
     * off unrelated requests; a fifteen minute access token is not.
     */
    response.cookie(ACCESS_COOKIE_NAME, grant.accessToken, {
      ...this.base(),
      path: ACCESS_COOKIE_PATH,
      maxAge: WEB_ACCESS_TTL_MS,
    });
    response.cookie(REFRESH_COOKIE_NAME, grant.refreshToken, {
      ...this.base(),
      path: this.authPath,
      maxAge: WEB_REFRESH_TTL_MS,
    });
    /**
     * Guard: a readable marker carrying no secret, so the client can tell "signed
     * out" from "access token lapsed". The refresh cookie is scoped to the auth
     * subtree and the access cookie expires on its own, which leaves the sign-in
     * page unable to know whether a rotation is worth attempting — and probing
     * blindly spends the shared refresh rate limit on every anonymous visit.
     */
    response.cookie(SESSION_HINT_COOKIE_NAME, "1", {
      ...this.hintBase(),
      path: ACCESS_COOKIE_PATH,
      maxAge: WEB_REFRESH_TTL_MS,
    });
  }

  setOAuthState(response: Response, token: string): void {
    response.cookie(OAUTH_STATE_COOKIE_NAME, token, {
      ...this.base(),
      path: this.oauthPath,
      maxAge: 10 * 60 * 1000,
    });
  }

  setOAuthPending(response: Response, token: string): void {
    response.cookie(OAUTH_PENDING_COOKIE_NAME, token, {
      ...this.base(),
      path: this.authPath,
      maxAge: 10 * 60 * 1000,
    });
  }

  clearOAuthState(response: Response): void {
    response.clearCookie(OAUTH_STATE_COOKIE_NAME, {
      ...this.base(),
      path: this.oauthPath,
    });
  }

  clearOAuthPending(response: Response): void {
    response.clearCookie(OAUTH_PENDING_COOKIE_NAME, {
      ...this.base(),
      path: this.authPath,
    });
  }

  clearAuth(response: Response): void {
    response.clearCookie(ACCESS_COOKIE_NAME, {
      ...this.base(),
      path: ACCESS_COOKIE_PATH,
    });
    response.clearCookie(REFRESH_COOKIE_NAME, {
      ...this.base(),
      path: this.authPath,
    });
    response.clearCookie(SESSION_HINT_COOKIE_NAME, {
      ...this.hintBase(),
      path: ACCESS_COOKIE_PATH,
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
      sameSite: this.sameSite,
      secure: this.secure,
    };
  }

  private hintBase() {
    return {
      httpOnly: false,
      sameSite: this.sameSite,
      secure: this.secure,
    };
  }
}
