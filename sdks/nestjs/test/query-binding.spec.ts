import "reflect-metadata";
import { Controller, Get, Headers, Query } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { describe, expect, it } from "vitest";
import { McpTool } from "../src/decorators.js";
import {
  discoverEndpoints,
  type DiscoveryDiagnostic,
} from "../src/discovery/endpoint-discovery.js";

class ListOrdersQuery {
  @IsString()
  customerId!: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;
}

class RangeQuery {
  @IsInt()
  from!: number;

  @IsInt()
  to!: number;
}

class NestedQuery {
  @IsString()
  @IsOptional()
  status?: string;

  @ValidateNested()
  @Type(() => RangeQuery)
  range!: RangeQuery;
}

class BareQuery {
  status?: string;
}

@Controller("orders")
@McpTool()
class QueryController {
  @Get("list")
  list(@Query() _query: ListOrdersQuery): string {
    return "ok";
  }

  @Get("nested")
  nested(@Query() _query: NestedQuery): string {
    return "ok";
  }

  @Get("opaque")
  opaque(@Query() _query: Record<string, unknown>): string {
    return "ok";
  }

  @Get("bare")
  bare(@Query() _query: BareQuery): string {
    return "ok";
  }

  @Get("mixed")
  mixed(
    @Query() _query: ListOrdersQuery,
    @Query("status") _status: string,
  ): string {
    return "ok";
  }

  @Get("headers")
  headers(@Headers() _headers: Record<string, string>): string {
    return "ok";
  }
}

function discover(
  severity?: (code: string) => "warning" | "endpointDropped" | "fatal",
): {
  routes: Map<string, ReturnType<typeof discoverEndpoints>[number]>;
  diagnostics: DiagnosticList;
} {
  const diagnostics: DiagnosticList = [];
  const found = discoverEndpoints([{ metatype: QueryController }], {
    ...(severity === undefined ? {} : { severity }),
    report: (diagnostic) => diagnostics.push(diagnostic),
  });
  return {
    routes: new Map(found.map((entry) => [entry.handlerName, entry])),
    diagnostics,
  };
}

type DiagnosticList = DiscoveryDiagnostic[];

const codesFor = (diagnostics: DiagnosticList, handler: string): string[] =>
  diagnostics
    .filter((diagnostic) => diagnostic.message.includes(`.${handler} `))
    .map((diagnostic) => diagnostic.code);

describe("whole-object query binding", () => {
  const { routes, diagnostics } = discover();

  it("Q1: flattens a readable query DTO into one parameter per member", () => {
    expect(routes.get("list")?.descriptor.parameters).toEqual([
      {
        name: "customerId",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "page",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1 },
      },
    ]);
    expect(codesFor(diagnostics, "list")).toEqual([]);
  });

  it("Q2: keeps the readable members and reports the ones it cannot express", () => {
    expect(
      routes.get("nested")?.descriptor.parameters?.map((p) => p.name),
    ).toEqual(["status"]);
    expect(codesFor(diagnostics, "nested")).toEqual(["unbound_query_object"]);
  });

  it("Q3: drops the endpoint when no member of the query type can be read", () => {
    expect(routes.has("opaque")).toBe(false);
    expect(codesFor(diagnostics, "opaque")).toEqual(["unresolved_query_shape"]);
  });

  it("Q4: an undecorated DTO is unresolved, not an empty filter set", () => {
    expect(routes.has("bare")).toBe(false);
    expect(codesFor(diagnostics, "bare")).toEqual(["unresolved_query_shape"]);
  });

  it("Q5: names the way out in the message", () => {
    const message = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "unresolved_query_shape" &&
        diagnostic.message.includes(".bare "),
    )?.message;
    expect(message).toContain("class-validator");
    expect(message).toContain("options.schema.typeShape");
  });

  it("Q6: an explicit @Query('name') wins over the flattened member", () => {
    const status = routes
      .get("mixed")
      ?.descriptor.parameters?.filter((p) => p.name === "status");
    expect(status).toEqual([
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
    ]);
  });

  it("Q7: an unnamed @Headers() binding is reported, not silently dropped", () => {
    expect(routes.get("headers")?.descriptor.parameters).toBeUndefined();
    expect(codesFor(diagnostics, "headers")).toEqual(["unbound_header_object"]);
  });

  it("Q8: a downgraded severity publishes the endpoint without filters", () => {
    const downgraded = discover(() => "warning");
    expect(
      downgraded.routes.get("opaque")?.descriptor.parameters,
    ).toBeUndefined();
    expect(codesFor(downgraded.diagnostics, "opaque")).toEqual([
      "unresolved_query_shape",
    ]);
  });
});
