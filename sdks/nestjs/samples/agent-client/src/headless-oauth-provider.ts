import { randomUUID } from "node:crypto";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/client";

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
  private stashedCallback: URLSearchParams | undefined;
  private discovery: OAuthDiscoveryState | undefined;

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
      application_type: "native",
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

  /**
   * Guard: SEP-2352 binds the callback leg to the authorization server the discovery leg found, and
   * the SDK can only run that check when the provider persists the state across the redirect. Left
   * unimplemented the SDK logs the gap and proceeds, so an authorization-server mix-up would be
   * redeemed without anyone noticing.
   */
  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.discovery = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discovery;
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

    const callback = new URL(location, target).searchParams;
    if (callback.get("code") === null) {
      throw new Error(
        `headless oauth provider: authorization redirect carried no code: ${location}`,
      );
    }
    this.stashedCallback = callback;
  }

  /**
   * Guard: the whole callback query is kept, not just `code`. RFC 9207's `iss` rides here, and
   * `finishAuth` validates it against the recorded issuer only when it is handed the parameters —
   * given a bare code string it has nothing to check and an authorization-server mix-up passes.
   */
  consumeCallbackParams(): URLSearchParams {
    if (this.stashedCallback === undefined) {
      throw new Error(
        "headless oauth provider: no authorization callback captured yet; call redirectToAuthorization first",
      );
    }
    const callback = this.stashedCallback;
    this.stashedCallback = undefined;
    return callback;
  }
}
