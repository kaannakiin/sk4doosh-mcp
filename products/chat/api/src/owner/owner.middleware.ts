import { OWNER_COOKIE_NAME } from "@chat/contracts/chat/owner";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Response } from "express";

import type { AppConfig } from "../config/configuration.ts";
import { OwnerService } from "./owner.service.ts";
import type { RequestWithOwner } from "./request-owner.ts";

@Injectable()
export class OwnerMiddleware implements NestMiddleware {
  constructor(
    private readonly owners: OwnerService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Guard: middleware rather than a guard, because minting needs the response to
   * set a cookie on and a guard only sees the request. Reading goes through
   * `cookie-parser` rather than a hand rolled split: the value is percent decoded,
   * and decoding a malformed sequence throws — a `Cookie: chat_owner=100%` turned
   * every request into a 500 until the parser that catches it took over.
   * `httpOnly` keeps the token out of reach of any script on the page, and
   * `sameSite: "lax"` is only
   * sufficient because the web dev server proxies this api under its own origin —
   * a cross-site setup would need `none` plus `secure`, and every fetch would
   * need `credentials: "include"`.
   */
  use(
    request: RequestWithOwner,
    response: Response,
    next: NextFunction,
  ): void {
    const raw: unknown = request.cookies[OWNER_COOKIE_NAME];
    const cookie = typeof raw === "string" ? raw : undefined;

    void this.owners
      .resolve(cookie)
      .then(({ id, issuedToken }) => {
        request.owner = id;
        if (issuedToken !== undefined) {
          const owner = this.config.get("owner", { infer: true });
          response.cookie(OWNER_COOKIE_NAME, issuedToken, {
            httpOnly: true,
            sameSite: "lax",
            secure: owner.cookieSecure,
            path: "/",
            maxAge: owner.cookieTtlMs,
          });
        }
        next();
      })
      .catch(next);
  }
}
