import "reflect-metadata";
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IsOptional, IsString } from "class-validator";
import { beforeAll, describe, expect, it } from "vitest";
import { LiaisoCatalog } from "../src/catalog.js";
import { curate, hidden, McpTool } from "../src/decorators.js";
import { LiaisoModule } from "../src/liaiso.module.js";
import type { VisibilityDeclaration } from "../src/index.js";

class AnonymousGuard {
  canActivate(): boolean {
    return true;
  }

  describeVisibility(): VisibilityDeclaration {
    return { anonymous: "yes", policies: [] };
  }
}

class SearchOrdersQuery {
  @IsString()
  tenantId!: string;

  @IsString()
  @IsOptional()
  lim?: string;

  @IsString()
  @IsOptional()
  keyword?: string;
}

@Controller("orders")
class SearchIndexOrdersController {
  @Get()
  @McpTool({
    name: "find_orders",
    description: "Lists records.",
    arguments: curate<SearchOrdersQuery>({
      tenantId: hidden.from("tenant"),
      lim: { as: "max_results" },
      keyword: { description: "Serbest metin araması" },
    }),
  })
  @UseGuards(AnonymousGuard)
  list(@Query() _query: SearchOrdersQuery): void {}
}

describe("search index over the curated surface", () => {
  let catalog: LiaisoCatalog;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LiaisoModule.forRoot((options) => {
          options.arguments.provide("tenant", (caller) =>
            caller.claim("tenant"),
          );
        }),
      ],
      controllers: [SearchIndexOrdersController],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    catalog = app.get(LiaisoCatalog);
  });

  it("indexes a visible argument name", () => {
    expect(catalog.current.index.search("keyword", 20)).toEqual([
      "find_orders",
    ]);
  });

  it("indexes a curated argument description", () => {
    expect(catalog.current.index.search("arama", 20)).toEqual(["find_orders"]);
  });

  it("indexes a renamed argument under its agent name, never its wire name", () => {
    expect(catalog.current.index.search("max", 20)).toEqual(["find_orders"]);
    expect(catalog.current.index.search("lim", 20)).toEqual([]);
  });

  it("never indexes a hidden argument", () => {
    expect(catalog.current.index.search("tenant", 20)).toEqual([]);
  });
});
