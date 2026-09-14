import {
  challengeConfirmationSchema,
  challengeResendSchema,
  emailRegistrationSchema,
  oauthCallbackQuerySchema,
  oauthProfileCompletionSchema,
  oauthProviderParamsSchema,
  oauthStartQuerySchema,
  passwordLoginSchema,
  phoneLoginRequestSchema,
  phoneRegistrationSchema,
  type AuthSessionResponse,
  type ChallengeConfirmation,
  type ChallengeResend,
  type EmailRegistration,
  type OAuthCallbackQuery,
  type OAuthProfileCompletion,
  type OAuthProviderParams,
  type OAuthStartQuery,
  type PasswordLogin,
  type PendingChallenge,
  type PhoneLoginRequest,
  type PhoneRegistration,
} from "@chat/contracts/auth/auth";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { SkipThrottle, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";

import { AuthCookieService } from "./auth-cookie.service.ts";
import { AuthGuard } from "./auth.guard.ts";
import { AuthOriginGuard } from "./auth-origin.guard.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import { AuthService } from "./auth.service.ts";
import { NoStoreInterceptor } from "./no-store.interceptor.ts";
import { OAuthService } from "./oauth.service.ts";
import { requireAuth, type RequestWithAuth } from "./request-auth.ts";

const STRICT_AUTH_THROTTLE = {
  network: { limit: 50, ttl: 15 * 60 * 1000 },
  subject: { limit: 5, ttl: 15 * 60 * 1000 },
};

@Controller("auth")
@UseGuards(ThrottlerGuard, AuthOriginGuard)
@UseInterceptors(NoStoreInterceptor)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: AuthSessionService,
    private readonly oauth: OAuthService,
    private readonly cookies: AuthCookieService,
  ) {}

  @Post("register/email")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(STRICT_AUTH_THROTTLE)
  registerEmail(
    @Body({ schema: emailRegistrationSchema }) body: EmailRegistration,
  ): Promise<PendingChallenge> {
    return this.auth.registerEmail(body);
  }

  @Post("register/phone")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(STRICT_AUTH_THROTTLE)
  registerPhone(
    @Body({ schema: phoneRegistrationSchema }) body: PhoneRegistration,
  ): Promise<PendingChallenge> {
    return this.auth.registerPhone(body);
  }

  @Post("verification/confirm")
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_AUTH_THROTTLE)
  async confirmContact(
    @Body({ schema: challengeConfirmationSchema })
    body: ChallengeConfirmation,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const grant = await this.auth.confirmContact(body, request.get("user-agent"));
    this.cookies.issue(response, grant);

    return grant.response;
  }

  @Post("verification/resend")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(STRICT_AUTH_THROTTLE)
  resend(
    @Body({ schema: challengeResendSchema }) body: ChallengeResend,
  ): Promise<PendingChallenge> {
    return this.auth.resend(body.challengeId);
  }

  @Post("login/password")
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_AUTH_THROTTLE)
  async loginPassword(
    @Body({ schema: passwordLoginSchema }) body: PasswordLogin,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const grant = await this.auth.loginPassword(body, request.get("user-agent"));
    this.cookies.issue(response, grant);

    return grant.response;
  }

  @Post("login/phone/request")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(STRICT_AUTH_THROTTLE)
  requestPhoneLogin(
    @Body({ schema: phoneLoginRequestSchema }) body: PhoneLoginRequest,
  ): Promise<PendingChallenge> {
    return this.auth.requestPhoneLogin(body.phoneE164);
  }

  @Post("login/phone/confirm")
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_AUTH_THROTTLE)
  async confirmPhoneLogin(
    @Body({ schema: challengeConfirmationSchema })
    body: ChallengeConfirmation,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const grant = await this.auth.confirmPhoneLogin(
      body,
      request.get("user-agent"),
    );
    this.cookies.issue(response, grant);

    return grant.response;
  }

  @Get("oauth/:provider/start")
  @Throttle({ network: { limit: 20, ttl: 15 * 60 * 1000 } })
  async startOAuth(
    @Param({ schema: oauthProviderParamsSchema }) params: OAuthProviderParams,
    @Query({ schema: oauthStartQuerySchema }) query: OAuthStartQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const principal = await this.sessions.optional(this.cookies.access(request));
    const start = await this.oauth.start(params.provider, query.intent, principal);
    this.cookies.setOAuthState(response, start.stateToken);
    response.redirect(start.authorizationUrl);
  }

  @Get("oauth/:provider/callback")
  @Throttle({ network: { limit: 20, ttl: 15 * 60 * 1000 } })
  async oauthCallback(
    @Param({ schema: oauthProviderParamsSchema }) params: OAuthProviderParams,
    @Query({ schema: oauthCallbackQuerySchema }) query: OAuthCallbackQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      if (query.error !== undefined) {
        response.redirect(this.oauth.redirectUrl("oauth_state_invalid"));

        return;
      }
      const callbackUrl = this.oauth.callbackUrl(request.originalUrl);
      const result = await this.oauth.callback(
        params.provider,
        callbackUrl,
        this.cookies.oauthState(request),
        request.get("user-agent"),
      );
      this.cookies.clearOAuthState(response);
      if (result.kind === "session") {
        this.cookies.issue(response, result.grant);
        response.redirect(this.oauth.redirectUrl("success"));

        return;
      }
      if (result.kind === "profile_required") {
        this.cookies.setOAuthPending(response, result.pendingToken);
        response.redirect(this.oauth.redirectUrl("profile_required"));

        return;
      }
      response.redirect(this.oauth.redirectUrl("link_required"));
    } catch (error) {
      this.cookies.clearOAuthState(response);
      response.redirect(this.oauth.redirectUrl(errorCode(error)));
    }
  }

  @Post("oauth/complete")
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_AUTH_THROTTLE)
  async completeOAuthProfile(
    @Body({ schema: oauthProfileCompletionSchema })
    body: OAuthProfileCompletion,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const grant = await this.oauth.completeProfile(
      this.cookies.oauthPending(request),
      body,
      request.get("user-agent"),
    );
    this.cookies.clearOAuthPending(response);
    this.cookies.issue(response, grant);

    return grant.response;
  }

  @Post("refresh")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({
    network: { limit: 60, ttl: 15 * 60 * 1000 },
    subject: { limit: 30, ttl: 15 * 60 * 1000 },
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      this.cookies.issue(
        response,
        await this.sessions.refresh(this.cookies.refresh(request)),
      );
    } catch (error) {
      this.cookies.clearAuth(response);
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipThrottle({ network: true, subject: true })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.logoutCurrent(
      this.cookies.access(request),
      this.cookies.refresh(request),
    );
    this.cookies.clearAuth(response);
  }

  @Get("me")
  @SkipThrottle({ network: true, subject: true })
  @UseGuards(AuthGuard)
  me(@Req() request: RequestWithAuth): AuthSessionResponse {
    return this.sessions.responseFor(requireAuth(request).user);
  }
}

function errorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response: unknown = error.getResponse();
    if (
      typeof response === "object" &&
      response !== null &&
      "code" in response &&
      typeof response.code === "string"
    ) {
      return response.code;
    }
  }

  return "oauth_state_invalid";
}
