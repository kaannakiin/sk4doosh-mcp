import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  type CanActivate,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";
import { beforeAll, describe, expect, it } from "vitest";
import { SkMcpCatalog } from "../src/catalog.js";
import { McpIgnore, McpTool } from "../src/decorators.js";
import { SkMcpModule } from "../src/sk-mcp.module.js";

class NoteDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  weight?: number;
}

@Injectable()
class OpaqueGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class DeclaringGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }

  describeVisibility(): { anonymous: "no"; policies: string[] } {
    return { anonymous: "no", policies: ["OrdersRead"] };
  }
}

@Controller("orders")
@McpTool()
class CatalogOrdersController {
  @Get("ping")
  ping(): string {
    return "ok";
  }

  @Get(":id")
  @UseGuards(DeclaringGuard)
  getOrder(@Param("id", ParseIntPipe) _id: number): string {
    return "ok";
  }

  @Get("secret")
  @McpIgnore()
  secret(): string {
    return "ok";
  }

  @Post(":id/notes")
  @UseGuards(OpaqueGuard)
  addOrderNote(
    @Param("id", ParseIntPipe) _id: number,
    @Query("notify") _notify: boolean,
    @Body() _note: NoteDto,
  ): string {
    return "ok";
  }
}

@Controller("reports")
class UnmarkedController {
  @Get("summary")
  summary(): string {
    return "ok";
  }
}

describe("nest catalog", () => {
  let catalog: SkMcpCatalog;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SkMcpModule.forRoot()],
      controllers: [CatalogOrdersController, UnmarkedController],
      providers: [OpaqueGuard, DeclaringGuard],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    catalog = app.get(SkMcpCatalog);
  });

  it("selects only opted-in operations, most specific marker wins", () => {
    expect([...catalog.current.byName.keys()].sort()).toEqual([
      "catalog_orders_add_order_note",
      "catalog_orders_get_order",
      "catalog_orders_ping",
    ]);
  });

  it("derives the container prefix from the controller class", () => {
    const entry = catalog.find("catalog_orders_get_order");
    expect(entry?.descriptor.container).toBe("CatalogOrdersController");
    expect(entry?.descriptor.operationId).toBe("getOrder");
  });

  it("reads an undeclared guard as imperative with unknown anonymity", () => {
    expect(catalog.find("catalog_orders_add_order_note")?.descriptor.auth).toEqual({
      anonymous: "unknown",
      policies: [],
      imperative: true,
    });
  });

  it("reads a declaring guard into anonymous and policies", () => {
    expect(catalog.find("catalog_orders_get_order")?.descriptor.auth).toEqual({
      anonymous: "no",
      policies: ["OrdersRead"],
      imperative: false,
    });
    expect([...catalog.current.policyNames]).toEqual(["OrdersRead"]);
  });

  it("treats a guardless endpoint as unknown, not anonymous", () => {
    expect(catalog.find("catalog_orders_ping")?.descriptor.auth.anonymous).toBe("unknown");
  });

  it("builds an input schema and a request template", () => {
    const entry = catalog.find("catalog_orders_add_order_note");
    expect(entry?.tool.inputSchema).toEqual({
      type: "object",
      properties: {
        id: { type: "integer" },
        notify: { type: "boolean" },
        text: { type: "string" },
        weight: { type: "integer", minimum: 1 },
      },
      required: ["id", "text"],
      additionalProperties: false,
    });
    expect(entry?.template?.routeTemplate).toBe("/orders/{id}/notes");
  });

  it("reports no diagnostics for a clean host", () => {
    expect(catalog.current.diagnostics).toEqual([]);
    expect(catalog.current.fatal).toEqual([]);
  });
});
