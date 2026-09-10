import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HeadlessOAuthProvider } from "./headless-oauth-provider.js";

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

export type AuthMode = "oauth" | "token" | "bearer";

export interface ConnectOptions {
  readonly base: string;
  readonly user: string;
  readonly authMode: AuthMode;
  readonly token?: string;
}

export interface McpSession {
  readonly client: Client;
  close(): Promise<void>;
}

export class AuthFailure extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "AuthFailure";
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function textOf(result: CallToolResult): string {
  if ("content" in result && Array.isArray(result.content)) {
    const first: unknown = result.content[0];
    if (
      typeof first === "object" &&
      first !== null &&
      "type" in first &&
      first.type === "text" &&
      "text" in first &&
      typeof first.text === "string"
    ) {
      return first.text;
    }
  }
  throw new Error(`unexpected tool result content: ${JSON.stringify(result)}`);
}

export interface ToolCallOutcome<T> {
  readonly isError: boolean;
  readonly parsed: T;
}

export async function callTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallOutcome<T>> {
  const result = await client.callTool({ name, arguments: args });
  const parsed = JSON.parse(textOf(result)) as T;
  return { isError: result.isError === true, parsed };
}

async function fetchDemoToken(base: string, user: string): Promise<string> {
  const response = await fetch(`${base}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user }),
  });
  if (!response.ok) {
    throw new Error(`token request failed: ${response.status}`);
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

function requireToken(token: string | undefined): string {
  if (token === undefined || token.length === 0) {
    throw new AuthFailure("SKMCP_TOKEN is required when SKMCP_AUTH=bearer");
  }
  return token;
}

async function connectWithBearer(
  options: ConnectOptions,
  bearer: string,
): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${options.base}/mcp`),
    { requestInit: { headers: { authorization: `Bearer ${bearer}` } } },
  );
  const client = new Client({ name: "sk-mcp-example-agent", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

async function connectWithOAuth(options: ConnectOptions): Promise<McpSession> {
  const provider = new HeadlessOAuthProvider({
    redirectUrl: "http://127.0.0.1/callback",
    loginHint: options.user,
  });
  const mcpUrl = new URL(`${options.base}/mcp`);
  const client = new Client({ name: "sk-mcp-example-agent", version: "0.0.0" });

  try {
    await client.connect(
      new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider }),
    );
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }
    const retryTransport = new StreamableHTTPClientTransport(mcpUrl, {
      authProvider: provider,
    });
    await retryTransport.finishAuth(provider.consumeAuthorizationCode());
    await client.connect(retryTransport);
  }

  return { client, close: () => client.close() };
}

export async function connect(options: ConnectOptions): Promise<McpSession> {
  try {
    if (options.authMode === "token") {
      return await connectWithBearer(
        options,
        await fetchDemoToken(options.base, options.user),
      );
    }
    if (options.authMode === "bearer") {
      return await connectWithBearer(options, requireToken(options.token));
    }
    return await connectWithOAuth(options);
  } catch (error) {
    if (error instanceof AuthFailure) {
      throw error;
    }
    throw new AuthFailure(
      `failed to establish an MCP session: ${describeError(error)}`,
      { cause: error },
    );
  }
}
