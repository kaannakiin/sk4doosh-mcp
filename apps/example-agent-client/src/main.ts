import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env["SKMCP_BASE_URL"] ?? "http://127.0.0.1:5199";
const user = process.env["SKMCP_USER"] ?? "alice";
const [query = "sipariş", requestedTool, rawArguments = "{}"] =
  process.argv.slice(2);

interface ErrorResponse {
  readonly error: string;
  readonly message: string;
}

interface SearchResponse {
  readonly total: number;
  readonly results: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly parameters: string;
  }>;
}

type LoadResponse =
  | {
      readonly name: string;
      readonly description: string;
      readonly inputSchema: unknown;
    }
  | ErrorResponse;

type InvokeResponse =
  { readonly status: number; readonly body: string } | ErrorResponse;

const isError = (value: object): value is ErrorResponse => "error" in value;

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content)) {
    const first = content[0] as { type?: unknown; text?: unknown } | undefined;
    if (first?.type === "text" && typeof first.text === "string") {
      return first.text;
    }
  }
  throw new Error(`unexpected tool result: ${JSON.stringify(result)}`);
}

function step(label: string, detail: string): void {
  console.log(`\n[${label}]\n${detail}`);
}

async function token(): Promise<string> {
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

async function call<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse(textOf(result)) as T;
}

async function main(): Promise<number> {
  const bearer = await token();
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${bearer}` } },
  });
  const client = new Client({ name: "sk-mcp-example-agent", version: "0.0.0" });
  await client.connect(transport);

  try {
    const listed = await client.listTools();
    step("tools/list", listed.tools.map((t) => t.name).join(", "));

    const search = await call<SearchResponse>(client, "search_tools", {
      query,
    });
    step(
      `search_tools "${query}" (${search.results.length}/${search.total})`,
      search.results.map((r) => `${r.name}  ${r.parameters}`).join("\n"),
    );

    const chosen = requestedTool ?? search.results[0]?.name;
    if (chosen === undefined) {
      console.error("no tool matched the query");
      return 2;
    }

    const loaded = await call<LoadResponse>(client, "load_tool", {
      name: chosen,
    });
    if (isError(loaded)) {
      step(`load_tool ${chosen}`, `${loaded.error}: ${loaded.message}`);
      return 2;
    }
    step(`load_tool ${chosen}`, JSON.stringify(loaded.inputSchema));

    const invoked = await call<InvokeResponse>(client, "invoke_tool", {
      name: chosen,
      arguments: JSON.parse(rawArguments) as Record<string, unknown>,
    });
    step(`invoke_tool ${chosen} as ${user}`, JSON.stringify(invoked));
    return !isError(invoked) && invoked.status < 400 ? 0 : 1;
  } finally {
    await client.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
