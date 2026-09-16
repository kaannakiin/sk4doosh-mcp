import {
  connectCallbackQuerySchema,
  connectParamsSchema,
  type ConnectCallbackQuery,
  type ConnectionOutcome,
  type ConnectParams,
} from "@chat/contracts/integration/connect";
import {
  Controller,
  Get,
  Logger,
  Inject,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { AuthCookieService } from "../auth/auth-cookie.service.ts";
import { AuthGuard } from "../auth/auth.guard.ts";
import { AuthSessionService } from "../auth/auth-session.service.ts";
import { NoStoreInterceptor } from "../auth/no-store.interceptor.ts";
import { requireAuth, type RequestWithAuth } from "../auth/request-auth.ts";
import type { AppConfig } from "../config/configuration.ts";
import { ConnectionAuthorizationService } from "./connection-authorization.service.ts";

const CONNECT_THROTTLE = {
  network: { limit: 30, ttl: 15 * 60 * 1000 },
  subject: { limit: 10, ttl: 15 * 60 * 1000 },
};

@Controller("connections")
@UseGuards(ThrottlerGuard)
@UseInterceptors(NoStoreInterceptor)
export class ConnectionsController {
  private readonly logger = new Logger(ConnectionsController.name);

  private readonly redirectBase: string;

  constructor(
    private readonly connect: ConnectionAuthorizationService,
    private readonly sessions: AuthSessionService,
    private readonly cookies: AuthCookieService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.redirectBase = config.get("auth", {
      infer: true,
    }).connectionsRedirectUrl;
  }

  /**
   * Guard: both routes are browser navigations, so a failure redirects with a
   * status rather than throwing. An unhandled error would put a raw json
   * envelope in the address bar instead of a message on the page the reader just
   * left.
   */
  @Get(":integrationId/connect")
  @UseGuards(AuthGuard)
  @Throttle(CONNECT_THROTTLE)
  async start(
    @Param({ schema: connectParamsSchema }) params: ConnectParams,
    @Req() request: RequestWithAuth,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const principal = requireAuth(request);
      const outcome = await this.connect.start(
        principal.user.internalId,
        params.integrationId,
      );

      response.redirect(
        outcome.kind === "redirect"
          ? outcome.url
          : this.landing(outcome.outcome),
      );
    } catch (cause) {
      this.fell(cause, "starting an authorization");
      response.redirect(this.landing("connection_failed"));
    }
  }

  @Get("callback")
  @Throttle(CONNECT_THROTTLE)
  async callback(
    @Query({ schema: connectCallbackQuerySchema }) query: ConnectCallbackQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const principal = await this.sessions.optional(
        this.cookies.access(request),
      );

      response.redirect(
        this.landing(
          principal === undefined
            ? "attempt_invalid"
            : await this.connect.complete(query, principal.user.internalId),
        ),
      );
    } catch (cause) {
      this.fell(cause, "completing an authorization");
      response.redirect(this.landing("connection_failed"));
    }
  }

  /**
   * Guard: the reader is still told one of the closed statuses, but the reason
   * is written down. Both routes answer a browser navigation, so they swallow
   * every throw to keep a json envelope out of the address bar — and a swallowed
   * throw with nothing logged is a failure nobody can diagnose afterwards.
   */
  private fell(cause: unknown, doing: string): void {
    this.logger.error(
      `${doing} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  /**
   * Guard: the browser is only ever told one of a closed set of statuses. What a
   * remote authorization server put in `error_description` is attacker-supplied
   * text, and reflecting it into the address bar of this product's own origin is
   * how that text gets read as this product's words.
   */
  private landing(outcome: ConnectionOutcome): string {
    const url = new URL(this.redirectBase);
    url.searchParams.set("status", outcome);

    return url.href;
  }
}
