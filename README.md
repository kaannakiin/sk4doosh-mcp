# liaiso

**Swagger for agents.** liaiso turns what you already have — an HTTP backend, a folder of
spreadsheets, a SQL Server database — into tools an AI agent can find and call over the
[Model Context Protocol](https://modelcontextprotocol.io).

It comes in two shapes:

- **The HTTP catalog** embeds in an ASP.NET Core or NestJS backend. It exposes your endpoints as a
  search-first tool catalog and replays every agent call through your backend's **own request
  pipeline**, so your authentication, authorization and validation apply unchanged. For a backend
  on any other stack, an OpenAPI gateway builds the same catalog from its document.
- **Source servers** are standalone, read-only MCP servers for local files and databases: Excel,
  XML, PDF and Microsoft SQL Server, plus a server that hands bounded language work to a local
  model.

> **Status:** early. Nothing is published to npm or NuGet yet; build from source (below). The
> spec, the fixture corpus and both SDKs are tested in CI; APIs may still change.

## Why

A naive MCP adapter turns every endpoint into a tool and forwards calls over the network. That
floods the agent's context, loses the caller's identity and silently papers over what it cannot
represent. liaiso instead:

- shows the agent **three meta-tools** (`search_tools`, `load_tool`, `invoke_tool`) rather than the
  whole catalog, so the size of your API does not grow the agent's context;
- decides **what a caller can see** from the backend's own authorization, and still enforces every
  call in the backend at invoke time;
- treats every silent resolution — a name collision, an unknown argument, a truncated response — as
  an error with a code the agent can act on.

The longer argument is on the docs site:
[why liaiso is not an OpenAPI adapter](apps/docs/src/content/http-catalog/explanation/06-why-liaiso-is-not-an-openapi-adapter.md).

## Quick start

Requirements: Node.js 24+, pnpm 11 (`corepack enable`), and the .NET 8 or 10 SDK for the C# side.

```bash
git clone https://github.com/kaannakiin/liaiso.git
cd liaiso
pnpm install
pnpm build
```

Then pick what you need:

| I want to…                                  | Start here                                                   |
| ------------------------------------------- | ------------------------------------------------------------ |
| Expose an ASP.NET Core API to agents        | [sdks/dotnet](sdks/dotnet/README.md)                         |
| Expose a NestJS API to agents               | [sdks/nestjs](sdks/nestjs/README.md)                         |
| Expose any backend that has an OpenAPI file | [packages/servers/openapi-mcp](packages/servers/openapi-mcp) |
| Let an agent read Excel workbooks           | [packages/servers/excel-mcp](packages/servers/excel-mcp)     |
| Let an agent read XML documents             | [packages/servers/xml-mcp](packages/servers/xml-mcp)         |
| Let an agent read PDF documents             | [packages/servers/pdf-mcp](packages/servers/pdf-mcp)         |
| Let an agent query SQL Server, read-only    | [packages/servers/mssql-mcp](packages/servers/mssql-mcp)     |
| Hand bounded text work to a local model     | [packages/servers/llm-mcp](packages/servers/llm-mcp)         |
| Build my own read-only MCP server           | [packages/cores/mcp-core](packages/cores/mcp-core)           |

Each package README has its own quick start, configuration and limits.

## Packages

### HTTP catalog

| Package                                             | What it is                                                            | Status    |
| --------------------------------------------------- | --------------------------------------------------------------------- | --------- |
| [Liaiso.AspNetCore](sdks/dotnet)                    | ASP.NET Core SDK                                                      | alpha     |
| [@liaiso/sdk-nestjs](sdks/nestjs)                   | NestJS SDK                                                            | internal  |
| [@liaiso/openapi-mcp](packages/servers/openapi-mcp) | Gateway: an OpenAPI document as a catalog over a remote backend       | internal  |
| [@liaiso/openapi](packages/http/openapi)            | Swagger 2.0 / OpenAPI 3.0–3.2 ingestion                               | internal  |
| [@liaiso/core](packages/http/core)                  | TypeScript reference implementation of the spec                       | internal  |
| [spec](packages/http/spec)                          | The normative spec and JSON Schemas — the single source of truth      | normative |
| [conformance](packages/http/conformance)            | 480 JSON fixtures across 11 kinds that every implementation must pass | —         |

### Source servers and their cores

| Package                                                        | What it is                                                   | Status      |
| -------------------------------------------------------------- | ------------------------------------------------------------ | ----------- |
| [@liaiso/excel-mcp](packages/servers/excel-mcp)                | Reads local Excel workbooks                                  | publishable |
| [@liaiso/xml-mcp](packages/servers/xml-mcp)                    | Reads local XML documents                                    | publishable |
| [@liaiso/pdf-mcp](packages/servers/pdf-mcp)                    | Reads local PDF documents, with pluggable OCR                | publishable |
| [@liaiso/mssql-mcp](packages/servers/mssql-mcp)                | Read-only Microsoft SQL Server                               | publishable |
| [@liaiso/llm-mcp](packages/servers/llm-mcp)                    | Delegates bounded language work to a local model (Ollama)    | publishable |
| [@liaiso/ocr-ollama](packages/adapters/ocr-ollama)             | OCR provider for pdf-mcp                                     | publishable |
| [@liaiso/pdf-raster-pdfjs](packages/adapters/pdf-raster-pdfjs) | Page rasterizer for pdf-mcp                                  | publishable |
| [@liaiso/mcp-core](packages/cores/mcp-core)                    | Source-agnostic machinery for read-only MCP servers          | publishable |
| [@liaiso/file-core](packages/cores/file-core)                  | Sandboxed file layer over mcp-core                           | publishable |
| [@liaiso/db-core](packages/cores/db-core)                      | Relational layer over mcp-core; dialects and drivers plug in | publishable |
| [@liaiso/ooxml-core](packages/cores/ooxml-core)                | Reader for OOXML (zip/OPC) containers                        | publishable |

"Publishable" means the package is built and checked for publication in CI but not on npm yet.

### Also in this repository

- [apps/docs](apps/docs) — the documentation site (TanStack Start). Run it with
  `pnpm --filter @liaiso/docs dev` and open `http://localhost:5180`.
- [products/chat](products/chat) — a chat product built on these servers. It is a separate
  product line and shares only the toolchain.

## How the HTTP catalog works

1. At startup the SDK reads your framework's route and authorization metadata and builds a catalog
   of tools, named by fixed rules; a name collision fails startup.
2. An agent calls `search_tools`, gets compact cards for the tools **this caller** may use, and
   `load_tool` for the full schema of the one it picks.
3. `invoke_tool` composes an HTTP request from the arguments and replays it through your pipeline
   as the caller. The response is mapped to a fixed error vocabulary and a size budget before it
   reaches the agent.

The rules for each step are in the [spec](packages/http/spec/README.md), and the
[conformance corpus](packages/http/conformance) pins them so the TypeScript and C#
implementations cannot drift apart.

## Documentation

- **Guides and reference:** the docs site in [apps/docs](apps/docs) (tutorials, how-tos,
  explanations).
- **The spec:** [packages/http/spec](packages/http/spec/README.md).
- **What is planned:** [ROADMAP.md](ROADMAP.md).
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
