import "reflect-metadata";
import {
  All,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  type INestApplication,
} from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { McpServer } from "@modelcontextprotocol/server";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { Request, Response } from "express";
import { IsInt, IsOptional, IsString } from "class-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LiaisoCatalog } from "../src/catalog.js";
import { McpTool } from "../src/decorators.js";
import { LiaisoDispatcher } from "../src/dispatcher.js";
import { extensionTokens } from "../src/extension-points.js";
import type { FileResolveRequest, FileResolver } from "../src/files.js";
import type { InvokeResultMapper } from "../src/invoke-result-mapper.js";
import { registerLiaisoTools } from "../src/meta-tools.js";
import { LIAISO_OPTIONS, type LiaisoOptions } from "../src/options.js";
import { LiaisoModule } from "../src/liaiso.module.js";
import {
  LiaisoStreamableHttp,
  type LiaisoRequestHandler,
} from "../src/transport/streamable-http.js";
import type { CallerScopeResolver } from "../src/cache.js";
import { CallerVisibilityProvider } from "../src/visibility/provider.js";

interface UploadedPart {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function describePart(file: UploadedPart | undefined) {
  return file === undefined
    ? null
    : {
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        text: file.buffer.toString("utf8"),
        hex: file.buffer.toString("hex"),
      };
}

class TicketForm {
  @IsString()
  title!: string;

  @IsInt()
  @IsOptional()
  priority?: number;

  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

class TitleForm {
  @IsString()
  title!: string;
}

@Controller("form")
@McpTool()
class FormController {
  @Post("tickets")
  @McpTool({ consumes: "application/x-www-form-urlencoded" })
  ticket(@Body() body: TicketForm, @Req() req: Request) {
    return { body, contentType: req.headers["content-type"] ?? null };
  }

  @Post("upload")
  @McpTool({ files: { attachment: { mediaType: "text/csv" } } })
  @UseInterceptors(FileInterceptor("attachment"))
  upload(
    @UploadedFile() file: UploadedPart | undefined,
    @Body() body: TitleForm,
  ) {
    return { title: body.title, file: describePart(file) };
  }

  @Post("many")
  @McpTool({ files: { files: { multiple: true } } })
  @UseInterceptors(FilesInterceptor("files"))
  many(@UploadedFiles() files: UploadedPart[] | undefined) {
    return { files: (files ?? []).map((file) => describePart(file)) };
  }

  @Post("note")
  @McpTool({ consumes: "text/plain" })
  note(@Body() body: string, @Req() req: Request) {
    return { body, contentType: req.headers["content-type"] ?? null };
  }
}

interface Wire {
  readonly content: { readonly type: string; readonly text: string }[];
  readonly isError?: boolean;
}

@Controller()
class FormMcpController {
  private readonly serve: LiaisoRequestHandler;

  constructor(
    streamableHttp: LiaisoStreamableHttp,
    catalog: LiaisoCatalog,
    dispatcher: LiaisoDispatcher,
    visibility: CallerVisibilityProvider,
  ) {
    this.serve = streamableHttp.serve(() => {
      const server = new McpServer({ name: "nest-form", version: "0.0.0" });
      registerLiaisoTools(server, {
        catalog,
        dispatcher,
        mapper: state.mapper as InvokeResultMapper,
        visibility,
        scopes: state.scopes as CallerScopeResolver,
        options: state.options as LiaisoOptions,
      });
      return server;
    });
  }

  @All("mcp")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.serve(req, res);
  }
}

const state: {
  mapper?: InvokeResultMapper;
  scopes?: CallerScopeResolver;
  options?: LiaisoOptions;
} = {};

const stored: Record<string, Buffer> = {
  "att-1": Buffer.from("id,total\n1,10\n", "utf8"),
  "att-big": Buffer.alloc(100, 1),
};

class MemoryResolver implements FileResolver {
  readonly refDescription = "An attachment id returned by upload_attachment.";
  readonly seen: FileResolveRequest[] = [];

  resolve(request: FileResolveRequest) {
    this.seen.push(request);
    if (request.ref === "att-hang") {
      return new Promise<never>(() => undefined);
    }
    if (request.ref === "att-denied") {
      return Promise.resolve({
        ok: false as const,
        reason: "forbidden" as const,
      });
    }
    if (request.ref === "att-busy") {
      return Promise.resolve({
        ok: false as const,
        reason: "unavailable" as const,
      });
    }
    const bytes = stored[request.ref];
    return Promise.resolve(
      bytes === undefined
        ? { ok: false as const, reason: "not_found" as const }
        : {
            ok: true as const,
            bytes,
            filename: "rapor.csv",
            mediaType: "text/csv",
          },
    );
  }
}

interface Host {
  readonly app: INestApplication;
  readonly catalog: LiaisoCatalog;
  readonly client: Client;
}

async function startHost(
  configure: (options: LiaisoOptions) => void,
  textParser: boolean,
): Promise<Host> {
  const moduleRef = await Test.createTestingModule({
    imports: [LiaisoModule.forRoot(configure)],
    controllers: [FormController, FormMcpController],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  if (textParser) {
    app.useBodyParser("text");
  }
  await app.init();
  await app.listen(0);
  state.mapper = app.get<InvokeResultMapper>(
    extensionTokens.invokeResultMapper,
  );
  state.scopes = app.get<CallerScopeResolver>(
    extensionTokens.callerScopeResolver,
  );
  state.options = app.get<LiaisoOptions>(LIAISO_OPTIONS);
  const client = new Client({ name: "form-probe", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${await app.getUrl()}/mcp`)),
  );
  return { app, catalog: app.get(LiaisoCatalog), client };
}

function toolFor(host: Host, route: string): string {
  const entry = [...host.catalog.current.byName.values()].find(
    (candidate) => candidate.descriptor.route === route,
  );
  expect(entry, `no tool for ${route}`).toBeDefined();
  return entry!.tool.name;
}

async function invoke<T>(
  host: Host,
  route: string,
  args: Record<string, unknown>,
): Promise<{ parsed: T; isError: boolean }> {
  const result = (await host.client.callTool({
    name: "invoke_tool",
    arguments: { name: toolFor(host, route), arguments: args },
  })) as unknown as Wire;
  return {
    parsed: JSON.parse(result.content[0]?.text ?? "{}") as T,
    isError: result.isError === true,
  };
}

interface Success<T> {
  readonly status: number;
  readonly body: T;
}

interface Refusal {
  readonly error: string;
  readonly message: string;
  readonly retryable: boolean;
}

describe("form and multipart bodies through invoke_tool", () => {
  const resolver = new MemoryResolver();
  let host: Host;

  beforeAll(async () => {
    host = await startHost((options) => {
      options.files.resolver = resolver;
      options.invoke.maxInlineFileBytes = 32;
      options.invoke.maxFileBytes = 64;
      options.invoke.timeoutMs = 300;
    }, true);
  });

  afterAll(async () => {
    await host.client.close();
    await host.app.close();
  });

  it("F1 binds a urlencoded body through Express's own parser", async () => {
    const { parsed } = await invoke<
      Success<{ body: unknown; contentType: string }>
    >(host, "/form/tickets", {
      title: "İzmir & co",
      priority: 3,
      tags: ["a", "b"],
    });
    expect(parsed.status).toBe(201);
    expect(parsed.body.contentType).toBe("application/x-www-form-urlencoded");
    expect(parsed.body.body).toEqual({
      title: "İzmir & co",
      priority: "3",
      tags: ["a", "b"],
    });
  });

  it("F2 sends a text file and a field as multipart parts multer reads, keeping a non-ASCII name", async () => {
    const { parsed } = await invoke<Success<{ title: string; file: unknown }>>(
      host,
      "/form/upload",
      { title: "t", attachment: { text: "a,b\n1,2", name: "çizim ğ.csv" } },
    );
    expect(parsed.status).toBe(201);
    expect(parsed.body.title).toBe("t");
    expect(parsed.body.file).toMatchObject({
      name: "çizim ğ.csv",
      type: "text/csv",
      size: 7,
      text: "a,b\n1,2",
    });
  });

  it("F3 decodes a base64 file to its exact bytes", async () => {
    const { parsed } = await invoke<
      Success<{ file: { hex: string; size: number } }>
    >(host, "/form/upload", { title: "t", attachment: { base64: "AAH+/w==" } });
    expect(parsed.body.file).toMatchObject({ hex: "0001feff", size: 4 });
  });

  it("F4 repeats a file part for a files interceptor", async () => {
    const { parsed } = await invoke<Success<{ files: { name: string }[] }>>(
      host,
      "/form/many",
      {
        files: [
          { text: "a", name: "a.txt" },
          { text: "b", name: "b.txt" },
        ],
      },
    );
    expect(parsed.body.files.map((file) => file.name)).toEqual([
      "a.txt",
      "b.txt",
    ]);
  });

  it("F5 resolves a ref inside the dispatch and hands the resolver the call's context", async () => {
    const before = resolver.seen.length;
    const { parsed } = await invoke<Success<{ file: unknown }>>(
      host,
      "/form/upload",
      {
        title: "t",
        attachment: { ref: "att-1" },
      },
    );
    expect(parsed.body.file).toMatchObject({
      name: "rapor.csv",
      type: "text/csv",
      text: "id,total\n1,10\n",
    });
    const request = resolver.seen[before];
    expect(request?.field).toBe("attachment");
    expect(request?.target.route).toBe("/form/upload");
    expect(request?.maxBytes).toBe(64);
    expect(request?.signal.aborted).toBe(false);
  });

  it("F6 answers a missing and a forbidden ref with one message", async () => {
    const missing = await invoke<Refusal>(host, "/form/upload", {
      title: "t",
      attachment: { ref: "att-nope" },
    });
    const denied = await invoke<Refusal>(host, "/form/upload", {
      title: "t",
      attachment: { ref: "att-denied" },
    });
    expect(missing.isError).toBe(true);
    expect(missing.parsed).toEqual(denied.parsed);
    expect(missing.parsed).toMatchObject({
      error: "file_unresolved",
      retryable: false,
    });
  });

  it("F7 marks an unavailable resolver retryable", async () => {
    const { parsed } = await invoke<Refusal>(host, "/form/upload", {
      title: "t",
      attachment: { ref: "att-busy" },
    });
    expect(parsed).toMatchObject({ error: "file_unresolved", retryable: true });
  });

  it("F8 refuses a resolved file over the per-file limit", async () => {
    const { parsed } = await invoke<Refusal>(host, "/form/upload", {
      title: "t",
      attachment: { ref: "att-big" },
    });
    expect(parsed).toEqual({
      error: "file_too_large",
      message:
        "File argument 'attachment' is over the limit of 64 bytes and was not sent.",
      retryable: false,
    });
  });

  it("F9 bounds a resolver that never answers by the invoke deadline", async () => {
    const started = Date.now();
    const { parsed } = await invoke<Refusal>(host, "/form/upload", {
      title: "t",
      attachment: { ref: "att-hang" },
    });
    expect(parsed).toMatchObject({ error: "invoke_timeout", retryable: true });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(resolver.seen.at(-1)?.signal.aborted).toBe(true);
  });

  it("F10 refuses inline base64 over the budget before anything is dispatched", async () => {
    const { parsed } = await invoke<Refusal>(host, "/form/upload", {
      title: "t",
      attachment: { base64: Buffer.alloc(40, 7).toString("base64") },
    });
    expect(parsed).toMatchObject({ error: "file_too_large", retryable: false });
    expect(parsed.message).toContain("inline limit of 32 bytes");
    expect(parsed.message).toContain("'ref'");
  });

  it("F11 sends a text/plain body the host registered a parser for", async () => {
    const { parsed } = await invoke<
      Success<{ body: string; contentType: string }>
    >(host, "/form/note", { body: "satır 1\nsatır 2" });
    expect(parsed.body).toEqual({
      body: "satır 1\nsatır 2",
      contentType: "text/plain; charset=utf-8",
    });
  });

  it("F12 offers ref in the loaded schema when a resolver is bound", async () => {
    const result = (await host.client.callTool({
      name: "load_tool",
      arguments: { name: toolFor(host, "/form/upload") },
    })) as unknown as Wire;
    const loaded = JSON.parse(result.content[0]?.text ?? "{}") as {
      inputSchema: {
        properties: Record<string, { properties?: Record<string, unknown> }>;
      };
    };
    expect(
      Object.keys(
        loaded.inputSchema.properties["attachment"]?.properties ?? {},
      ),
    ).toContain("ref");
  });
});

describe("a host with no resolver and no text parser", () => {
  let host: Host;

  beforeAll(async () => {
    host = await startHost(() => undefined, false);
  });

  afterAll(async () => {
    await host.client.close();
    await host.app.close();
  });

  it("F13 publishes no ref and refuses one as an unknown key", async () => {
    const entry = [...host.catalog.current.byName.values()].find(
      (candidate) => candidate.descriptor.route === "/form/upload",
    );
    expect(entry).toBeDefined();
    const properties = entry!.tool.inputSchema.properties as Record<
      string,
      { properties?: Record<string, unknown> }
    >;
    const attachment = properties["attachment"];
    expect(Object.keys(attachment?.properties ?? {})).not.toContain("ref");
    const { parsed } = await invoke<Refusal>(host, "/form/upload", {
      title: "t",
      attachment: { ref: "att-1" },
    });
    expect(parsed.error).toBe("invalid_file_argument");
    expect(parsed.message).not.toContain("ref,");
  });

  it("F14 drops a text/plain endpoint whose parser is not registered", () => {
    const codes = host.catalog.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("body_parser_missing");
    expect(
      [...host.catalog.current.byName.values()].some(
        (entry) => entry.descriptor.route === "/form/note",
      ),
    ).toBe(false);
  });
});
