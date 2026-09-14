import "reflect-metadata";
import { Controller, Get, Query } from "@nestjs/common";
import { IsEnum, IsIn, IsOptional, IsString } from "class-validator";
import { describe, expect, it } from "vitest";
import { McpTool } from "../src/decorators.js";
import { discoverEndpoints } from "../src/discovery/endpoint-discovery.js";

enum Status {
  Active = "active",
  Closed = "closed",
}

enum Priority {
  Low,
  High,
}

class EnumQuery {
  @IsEnum(Status)
  status!: Status;

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsIn(["asc", "desc"])
  @IsOptional()
  order?: string;

  @IsIn([10, 25, 50])
  @IsOptional()
  size?: number;

  @IsIn([0.5, 1.5])
  @IsOptional()
  ratio?: number;

  @IsString()
  @IsEnum(Status)
  @IsOptional()
  echo?: Status;

  @IsEnum(Status, { each: true })
  @IsOptional()
  states?: Status[];
}

@Controller("orders")
@McpTool()
class EnumController {
  @Get("list")
  list(@Query() _query: EnumQuery): string {
    return "ok";
  }
}

const parameters = (): Record<string, unknown> => {
  const [found] = discoverEndpoints([{ metatype: EnumController }], {});
  const bag: Record<string, unknown> = {};
  for (const parameter of found?.descriptor.parameters ?? []) {
    bag[parameter.name] = parameter.schema;
  }
  return bag;
};

describe("enum binding", () => {
  const bag = parameters();

  it("E1: a string enum becomes a string with its values", () => {
    expect(bag["status"]).toEqual({
      type: "string",
      enum: ["active", "closed"],
    });
  });

  it("E2: a numeric enum becomes an integer with its numbers, not its names", () => {
    expect(bag["priority"]).toEqual({ type: "integer", enum: [0, 1] });
  });

  it("E3: @IsIn over strings becomes a string enum", () => {
    expect(bag["order"]).toEqual({ type: "string", enum: ["asc", "desc"] });
  });

  it("E4: @IsIn over integers becomes an integer enum", () => {
    expect(bag["size"]).toEqual({ type: "integer", enum: [10, 25, 50] });
  });

  it("E5: @IsIn over floats produces no enum, because the wire form has no type", () => {
    expect(bag["ratio"]).toEqual({ type: "number" });
  });

  it("E6: an enum beats a plain scalar declared beside it", () => {
    expect(bag["echo"]).toEqual({ type: "string", enum: ["active", "closed"] });
  });

  it("E7: each: true wraps the enum in an array", () => {
    expect(bag["states"]).toEqual({
      type: "array",
      items: { type: "string", enum: ["active", "closed"] },
    });
  });
});
