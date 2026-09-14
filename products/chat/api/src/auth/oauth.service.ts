import {
  githubOAuthEmailsSchema,
  githubOAuthProfileSchema,
  googleOAuthProfileSchema,
  oauthPendingProfileSchema,
  oauthStateEnvelopeSchema,
  type AuthProvider,
  type OAuthIntent,
  type OAuthProfileCompletion,
} from "@chat/contracts/auth/auth";
import { isUniqueConstraintError } from "@chat/db";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as oauth from "oauth4webapi";

import type {
  AppConfig,
  OAuthProviderConfig,
} from "../config/configuration.ts";
import { AuthCryptoService } from "./auth-crypto.service.ts";
import { AuthErrorsService } from "./auth-errors.service.ts";
import { AuthSessionRepository } from "./auth-session.repository.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import type { AuthPrincipal, SessionGrant } from "./auth.types.ts";
import { OAuthRepository } from "./oauth.repository.ts";

const OAUTH_ENVELOPE_TTL_MS = 10 * 60 * 1000;

interface ProviderProfile {
  readonly providerAccountId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface OAuthStart {
  readonly authorizationUrl: string;
  readonly stateToken: string;
}

export type OAuthCallbackResult =
  | { readonly kind: "session"; readonly grant: SessionGrant }
  | { readonly kind: "profile_required"; readonly pendingToken: string }
  | { readonly kind: "link_required" };

const GOOGLE_AS: oauth.AuthorizationServer = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  code_challenge_methods_supported: ["S256"],
  id_token_signing_alg_values_supported: ["RS256"],
};

const GITHUB_AS: oauth.AuthorizationServer = {
  issuer: "https://github.com",
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
  code_challenge_methods_supported: ["S256"],
};

@Injectable()
export class OAuthService {
  private readonly authConfig: AppConfig["auth"];

  constructor(
    private readonly repository: OAuthRepository,
    private readonly sessionRepository: AuthSessionRepository,
    private readonly crypto: AuthCryptoService,
    private readonly sessions: AuthSessionService,
    private readonly errors: AuthErrorsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.authConfig = config.get("auth", { infer: true });
  }

  async start(
    provider: AuthProvider,
    intent: OAuthIntent,
    principal: AuthPrincipal | undefined,
  ): Promise<OAuthStart> {
    if (intent === "link" && principal === undefined) {
      this.errors.fail("unauthorized", HttpStatus.UNAUTHORIZED);
    }
    const providerConfig = this.providerConfig(provider);
    const state = oauth.generateRandomState();
    const verifier = oauth.generateRandomCodeVerifier();
    const nonce = oauth.generateRandomNonce();
    const challenge = await oauth.calculatePKCECodeChallenge(verifier);
    const as = this.authorizationServer(provider);
    const authorizationEndpoint = as.authorization_endpoint;
    if (authorizationEndpoint === undefined) {
      throw new Error(`OAuth authorization endpoint is missing for ${provider}`);
    }
    const authorizationUrl = new URL(authorizationEndpoint);
    authorizationUrl.searchParams.set("client_id", providerConfig.clientId);
    authorizationUrl.searchParams.set("redirect_uri", providerConfig.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set(
      "scope",
      provider === "google" ? "openid email profile" : "read:user user:email",
    );
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    if (provider === "google") {
      authorizationUrl.searchParams.set("nonce", nonce);
      authorizationUrl.searchParams.set("prompt", "select_account");
    }

    const stateToken = await this.crypto.seal(
      "oauth-state",
      {
        kind: "oauth_state",
        provider,
        intent,
        state,
        verifier,
        nonce,
        userId: principal?.user.internalId,
        sessionPublicId: principal?.sessionPublicId,
      },
      OAUTH_ENVELOPE_TTL_MS,
    );

    return { authorizationUrl: authorizationUrl.toString(), stateToken };
  }

  async callback(
    provider: AuthProvider,
    callbackUrl: URL,
    encryptedState: string | undefined,
    userAgent?: string,
  ): Promise<OAuthCallbackResult> {
    if (encryptedState === undefined) {
      this.errors.fail("oauth_state_invalid", HttpStatus.UNAUTHORIZED);
    }
    const payload = await this.crypto.unseal("oauth-state", encryptedState);
    const parsed = oauthStateEnvelopeSchema.safeParse(payload);
    if (!parsed.success || parsed.data.provider !== provider) {
      this.errors.fail("oauth_state_invalid", HttpStatus.UNAUTHORIZED);
    }

    const profile = await this.exchangeProfile(
      provider,
      callbackUrl,
      parsed.data.state,
      parsed.data.verifier,
      parsed.data.nonce,
    );
    const linked = await this.repository.findOAuthUser(provider,
      profile.providerAccountId,
    );

    if (parsed.data.intent === "link") {
      if (
        parsed.data.userId === undefined ||
        parsed.data.sessionPublicId === undefined
      ) {
        this.errors.fail("oauth_state_invalid", HttpStatus.UNAUTHORIZED);
      }
      const activeSession = await this.sessionRepository.findActiveSession(parsed.data.sessionPublicId,
        new Date(),
      );
      if (
        activeSession === undefined ||
        activeSession.user.internalId !== parsed.data.userId
      ) {
        this.errors.fail("unauthorized", HttpStatus.UNAUTHORIZED);
      }
      if (linked !== undefined && linked.internalId !== parsed.data.userId) {
        this.errors.fail("oauth_account_conflict", HttpStatus.CONFLICT);
      }
      if (linked === undefined) {
        try {
          await this.repository.linkOAuthAccount(parsed.data.userId,
            provider,
            profile.providerAccountId,
          );
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            this.errors.fail("oauth_account_conflict", HttpStatus.CONFLICT);
          }
          throw error;
        }
      }
      await this.sessionRepository.revokeSession(parsed.data.sessionPublicId,
        new Date(),
      );

      return {
        kind: "session",
        grant: await this.sessions.createForUser(parsed.data.userId, userAgent),
      };
    }

    if (linked !== undefined) {
      if (linked.disabledAt !== null) {
        this.errors.fail("invalid_credentials", HttpStatus.UNAUTHORIZED);
      }

      return {
        kind: "session",
        grant: await this.sessions.createForUser(linked.internalId, userAgent),
      };
    }

    if (
      profile.email !== null &&
      profile.emailVerified &&
      (await this.repository.findUserByVerifiedEmail(profile.email)) !== undefined
    ) {
      return { kind: "link_required" };
    }

    if (profile.firstName === undefined || profile.lastName === undefined) {
      const pendingToken = await this.crypto.seal(
        "oauth-profile",
        {
          kind: "oauth_profile",
          provider,
          providerAccountId: profile.providerAccountId,
          email: profile.email,
          emailVerified: profile.emailVerified,
          suggestedFirstName: profile.firstName,
          suggestedLastName: profile.lastName,
        },
        OAUTH_ENVELOPE_TTL_MS,
      );

      return { kind: "profile_required", pendingToken };
    }

    return {
      kind: "session",
      grant: await this.createOAuthSession(
        {
          ...profile,
          firstName: profile.firstName,
          lastName: profile.lastName,
        },
        provider,
        userAgent,
      ),
    };
  }

  callbackUrl(originalUrl: string): URL {
    return new URL(originalUrl, this.authConfig.publicApiUrl);
  }

  async completeProfile(
    encryptedPending: string | undefined,
    input: OAuthProfileCompletion,
    userAgent?: string,
  ): Promise<SessionGrant> {
    if (encryptedPending === undefined) {
      this.errors.fail("oauth_state_invalid", HttpStatus.UNAUTHORIZED);
    }
    const payload = await this.crypto.unseal("oauth-profile", encryptedPending);
    const parsed = oauthPendingProfileSchema.safeParse(payload);
    if (!parsed.success) {
      this.errors.fail("oauth_state_invalid", HttpStatus.UNAUTHORIZED);
    }
    const existing = await this.repository.findOAuthUser(parsed.data.provider,
      parsed.data.providerAccountId,
    );
    if (existing !== undefined) {
      this.errors.fail("oauth_account_conflict", HttpStatus.CONFLICT);
    }
    if (
      parsed.data.email !== null &&
      parsed.data.emailVerified &&
      (await this.repository.findUserByVerifiedEmail(parsed.data.email)) !== undefined
    ) {
      this.errors.fail("oauth_link_required", HttpStatus.CONFLICT);
    }

    return this.createOAuthSession(
      {
        providerAccountId: parsed.data.providerAccountId,
        email: parsed.data.email,
        emailVerified: parsed.data.emailVerified,
        firstName: input.firstName,
        lastName: input.lastName,
      },
      parsed.data.provider,
      userAgent,
    );
  }

  redirectUrl(status: string): string {
    const target = new URL(this.authConfig.webRedirectUrl);
    target.searchParams.set("auth", status);

    return target.toString();
  }

  private async createOAuthSession(
    profile: ProviderProfile & { readonly firstName: string; readonly lastName: string },
    provider: AuthProvider,
    userAgent?: string,
  ): Promise<SessionGrant> {
    const material = this.sessions.createMaterial(userAgent);
    try {
      const session = await this.repository.createOAuthUserAndSession({
          provider,
          providerAccountId: profile.providerAccountId,
          email: profile.email,
          emailVerified: profile.emailVerified,
          firstName: profile.firstName,
          lastName: profile.lastName,
        },
        material.seed,
      );

      return this.sessions.grant(session, material.refreshToken);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        this.errors.fail("oauth_account_conflict", HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  private async exchangeProfile(
    provider: AuthProvider,
    callbackUrl: URL,
    expectedState: string,
    verifier: string,
    nonce: string,
  ): Promise<ProviderProfile> {
    const providerConfig = this.providerConfig(provider);
    const as = this.authorizationServer(provider);
    const client: oauth.Client = { client_id: providerConfig.clientId };
    let params: URLSearchParams;
    try {
      params = oauth.validateAuthResponse(as, client, callbackUrl, expectedState);
    } catch {
      this.errors.fail("oauth_state_invalid", HttpStatus.UNAUTHORIZED);
    }
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      oauth.ClientSecretPost(providerConfig.clientSecret),
      params,
      providerConfig.redirectUri,
      verifier,
    );
    const tokens = await oauth.processAuthorizationCodeResponse(
      as,
      client,
      response,
      provider === "google"
        ? { expectedNonce: nonce, requireIdToken: true }
        : undefined,
    );

    return provider === "google"
      ? this.googleProfile(tokens.access_token)
      : this.githubProfile(tokens.access_token);
  }

  private async googleProfile(accessToken: string): Promise<ProviderProfile> {
    const response = await oauth.protectedResourceRequest(
      accessToken,
      "GET",
      new URL("https://openidconnect.googleapis.com/v1/userinfo"),
    );
    const profile = googleOAuthProfileSchema.parse(await response.json());

    return {
      providerAccountId: profile.sub,
      email: profile.email?.toLowerCase() ?? null,
      emailVerified: profile.email_verified,
      firstName: profile.given_name,
      lastName: profile.family_name,
    };
  }

  private async githubProfile(accessToken: string): Promise<ProviderProfile> {
    const headers = new Headers({
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    });
    const [profileResponse, emailResponse] = await Promise.all([
      oauth.protectedResourceRequest(
        accessToken,
        "GET",
        new URL("https://api.github.com/user"),
        headers,
      ),
      oauth.protectedResourceRequest(
        accessToken,
        "GET",
        new URL("https://api.github.com/user/emails"),
        headers,
      ),
    ]);
    const profile = githubOAuthProfileSchema.parse(await profileResponse.json());
    const emails = githubOAuthEmailsSchema.parse(await emailResponse.json());
    const email =
      emails.find((candidate) => candidate.primary && candidate.verified) ??
      emails.find((candidate) => candidate.verified);
    const names = splitName(profile.name);

    return {
      providerAccountId: profile.id.toString(),
      email: email?.email.toLowerCase() ?? null,
      emailVerified: email !== undefined,
      firstName: names?.firstName,
      lastName: names?.lastName,
    };
  }

  private providerConfig(provider: AuthProvider): OAuthProviderConfig {
    const config = this.authConfig[provider];
    if (config === undefined) {
      this.errors.fail("oauth_provider_unavailable", HttpStatus.SERVICE_UNAVAILABLE);
    }

    return config;
  }

  private authorizationServer(provider: AuthProvider): oauth.AuthorizationServer {
    return provider === "google" ? GOOGLE_AS : GITHUB_AS;
  }
}

function splitName(
  displayName: string | null,
): { readonly firstName: string; readonly lastName: string } | undefined {
  if (displayName === null) {
    return undefined;
  }
  const [firstName, ...rest] = displayName.split(/\s+/u);
  const lastName = rest.join(" ");

  return firstName === undefined || lastName.length === 0
    ? undefined
    : { firstName, lastName };
}
