import { randomBytes, randomUUID } from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
import jwt from "jsonwebtoken";

export const demoOAuthSecret = "demo-nestjs-oauth-secret-0123456789abcdef";
export const demoIssuerUrl = new URL("http://127.0.0.1:3000");
export const demoResourceUrl = new URL("http://127.0.0.1:3000/mcp");

const demoUsers: Readonly<Record<string, readonly string[]>> = {
  alice: ["orders.read"],
  bob: [],
};

interface StoredCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource?: URL;
  scope: string[];
  user: string;
  expiresAt: number;
}

interface StoredRefreshToken {
  clientId: string;
  user: string;
  scope: string[];
}

function signAccessToken(
  user: string,
  clientId: string,
  scope: string[],
  resource: URL,
): string {
  return jwt.sign(
    { sub: user, client_id: clientId, scope: scope.join(" ") },
    demoOAuthSecret,
    {
      expiresIn: 3600,
      audience: resource.toString(),
    },
  );
}

export const demoVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, demoOAuthSecret) as jwt.JwtPayload;
    } catch {
      throw new InvalidTokenError("token is invalid or expired");
    }
    const audience = typeof payload.aud === "string" ? payload.aud : undefined;
    if (
      audience === undefined ||
      typeof payload.exp !== "number" ||
      typeof payload.client_id !== "string"
    ) {
      throw new InvalidTokenError("token is malformed");
    }
    const scope = typeof payload.scope === "string" ? payload.scope : "";
    return {
      token,
      clientId: payload.client_id,
      scopes: scope.length > 0 ? scope.split(" ") : [],
      expiresAt: payload.exp,
      resource: new URL(audience),
    };
  },
};

export class DemoOAuthProvider implements OAuthServerProvider {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly codes = new Map<string, StoredCode>();
  private readonly refreshTokens = new Map<string, StoredRefreshToken>();

  readonly clientsStore: OAuthRegisteredClientsStore = {
    getClient: (clientId) => this.clients.get(clientId),
    registerClient: (client) => {
      const clientId = randomUUID();
      const full: OAuthClientInformationFull = {
        ...client,
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
      this.clients.set(clientId, full);
      return full;
    },
  };

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const code = randomBytes(24).toString("hex");
    const hint = res.req?.query?.["login_hint"];
    const user = typeof hint === "string" && hint in demoUsers ? hint : "alice";
    this.codes.set(code, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      resource: params.resource,
      scope: params.scopes ?? [],
      user,
      expiresAt: Date.now() + 5 * 60_000,
    });
    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state !== undefined) {
      target.searchParams.set("state", params.state);
    }
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    return this.requireCode(authorizationCode).codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const entry = this.requireCode(authorizationCode);
    this.codes.delete(authorizationCode);
    if (entry.clientId !== client.client_id) {
      throw new InvalidGrantError(
        "authorization code was issued to a different client",
      );
    }
    if (redirectUri !== undefined && redirectUri !== entry.redirectUri) {
      throw new InvalidGrantError(
        "redirect_uri does not match the authorization request",
      );
    }
    const audience = resource ?? entry.resource;
    if (audience === undefined) {
      throw new InvalidGrantError(
        "resource is required to mint an access token",
      );
    }
    return this.issueTokens(
      entry.user,
      client.client_id,
      entry.scope,
      audience,
    );
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const entry = this.refreshTokens.get(refreshToken);
    if (entry === undefined || entry.clientId !== client.client_id) {
      throw new InvalidGrantError("refresh token is invalid");
    }
    if (resource === undefined) {
      throw new InvalidGrantError(
        "resource is required to mint an access token",
      );
    }
    this.refreshTokens.delete(refreshToken);
    return this.issueTokens(
      entry.user,
      client.client_id,
      scopes ?? entry.scope,
      resource,
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return demoVerifier.verifyAccessToken(token);
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.refreshTokens.delete(request.token);
  }

  async mintDemoToken(user: string): Promise<string> {
    const scope = demoUsers[user];
    if (scope === undefined) {
      throw new Error(`unknown demo user '${user}'`);
    }
    return signAccessToken(user, "demo-shortcut", [...scope], demoResourceUrl);
  }

  private issueTokens(
    user: string,
    clientId: string,
    scope: string[],
    resource: URL,
  ): OAuthTokens {
    const refreshToken = randomBytes(24).toString("hex");
    this.refreshTokens.set(refreshToken, { clientId, user, scope });
    return {
      access_token: signAccessToken(user, clientId, scope, resource),
      token_type: "bearer",
      expires_in: 3600,
      scope: scope.join(" "),
      refresh_token: refreshToken,
    };
  }

  private requireCode(code: string): StoredCode {
    const entry = this.codes.get(code);
    if (entry === undefined || entry.expiresAt < Date.now()) {
      throw new InvalidGrantError("authorization code is invalid or expired");
    }
    return entry;
  }
}
