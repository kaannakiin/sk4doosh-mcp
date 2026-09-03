import { randomUUID } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export interface HeadlessOAuthProviderOptions {
  readonly redirectUrl: string;
  readonly loginHint: string;
}

export class HeadlessOAuthProvider implements OAuthClientProvider {
  private readonly _redirectUrl: string;
  private readonly loginHint: string;
  private clientInfo: OAuthClientInformationFull | undefined;
  private currentTokens: OAuthTokens | undefined;
  private verifier: string | undefined;
  private stashedCode: string | undefined;

  constructor(options: HeadlessOAuthProviderOptions) {
    this._redirectUrl = options.redirectUrl;
    this.loginHint = options.loginHint;
  }

  get redirectUrl(): string {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "sk-mcp-example-agent",
      redirect_uris: [this._redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.clientInfo;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    this.clientInfo = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this.currentTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.currentTokens = tokens;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (this.verifier === undefined) {
      throw new Error("headless oauth provider: no PKCE code verifier saved");
    }
    return this.verifier;
  }

  state(): string {
    return randomUUID();
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const target = new URL(authorizationUrl);
    target.searchParams.set("login_hint", this.loginHint);

    const response = await fetch(target, { redirect: "manual" });
    const location = response.headers.get("location");
    if (location === null) {
      throw new Error(
        `headless oauth provider: authorization endpoint did not return a Location header (status ${response.status})`,
      );
    }

    const code = new URL(location, target).searchParams.get("code");
    if (code === null) {
      throw new Error(
        `headless oauth provider: authorization redirect carried no code: ${location}`,
      );
    }
    this.stashedCode = code;
  }

  consumeAuthorizationCode(): string {
    if (this.stashedCode === undefined) {
      throw new Error(
        "headless oauth provider: no authorization code captured yet; call redirectToAuthorization first",
      );
    }
    const code = this.stashedCode;
    this.stashedCode = undefined;
    return code;
  }
}
