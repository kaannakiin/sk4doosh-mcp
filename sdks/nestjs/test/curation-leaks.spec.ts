import "reflect-metadata";
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IsOptional, IsString } from "class-validator";
import { beforeAll, describe, expect, it } from "vitest";
import { SkMcpCatalog } from "../src/catalog.js";
import { curate, hidden, McpTool } from "../src/decorators.js";
import { SkMcpModule } from "../src/sk-mcp.module.js";
import type { CatalogDiagnostic, VisibilityDeclaration } from "../src/index.js";

class AnonymousGuard {
  canActivate(): boolean {
    return true;
  }

  describeVisibility(): VisibilityDeclaration {
    return { anonymous: "yes", policies: [] };
  }
}

class LeakQuery {
  @IsString()
  tenantId!: string;

  @IsString()
  @IsOptional()
  keyword?: string;
}

@Controller("in-description")
class LeaksInToolDescription {
  @Get()
  @McpTool({
    name: "leaks_in_tool_description",
    description: "Filters records by tenantId and keyword.",
    arguments: curate<LeakQuery>({ tenantId: hidden.value("acme") }),
  })
  @UseGuards(AnonymousGuard)
  list(@Query() _query: LeakQuery): void {}
}

@Controller("in-argument")
class LeaksInArgumentDescription {
  @Get()
  @McpTool({
    name: "leaks_in_argument_description",
    description: "Filters records.",
    arguments: curate<LeakQuery>({
      tenantId: hidden.value("acme"),
      keyword: { description: "Free text within the tenantId in scope." },
    }),
  })
  @UseGuards(AnonymousGuard)
  list(@Query() _query: LeakQuery): void {}
}

@Controller("clean")
class NamesNothingCurated {
  @Get()
  @McpTool({
    name: "names_nothing_curated",
    description: "Filters records.",
    arguments: curate<LeakQuery>({
      tenantId: hidden.value("acme"),
      keyword: { description: "Free text to match." },
    }),
  })
  @UseGuards(AnonymousGuard)
  list(@Query() _query: LeakQuery): void {}
}

describe("curation leak diagnostics", () => {
  let catalog: SkMcpCatalog;
  let diagnostics: readonly CatalogDiagnostic[];

  const forTool = (name: string): string[] =>
    diagnostics
      .filter((diagnostic) => diagnostic.message.includes(`'${name}'`))
      .map((diagnostic) => diagnostic.code)
      .sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SkMcpModule.forRoot()],
      controllers: [
        LeaksInToolDescription,
        LeaksInArgumentDescription,
        NamesNothingCurated,
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    catalog = app.get(SkMcpCatalog);
    diagnostics = catalog.diagnostics;
  });

  it("reports the tool description leak under the original code", () => {
    expect(forTool("leaks_in_tool_description")).toEqual([
      "curation_leaks_name",
    ]);
  });

  it("reports the curated argument description leak under its own code", () => {
    expect(forTool("leaks_in_argument_description")).toEqual([
      "curation_leaks_name_in_argument",
    ]);
  });

  it("stays silent when no curated prose names a curated argument", () => {
    expect(forTool("names_nothing_curated")).toEqual([]);
  });

  /**
   * The reason the argument-description leak earns a diagnostic at all: the wire name is now a
   * search term, so discovery routes an agent to a tool by a word `invoke_tool` will refuse.
   */
  it("is reachable by the wire name the agent cannot send", () => {
    expect(catalog.current.index.search("tenantId", 20)).toEqual([
      "leaks_in_tool_description",
      "leaks_in_argument_description",
    ]);
    expect(
      Object.keys(
        catalog.find("leaks_in_argument_description")?.tool.inputSchema
          .properties ?? {},
      ),
    ).toEqual(["keyword"]);
  });
});
