import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";
import { describe, expect, it } from "vitest";
import { McpTool } from "../src/decorators.js";
import { discoverEndpoints } from "../src/discovery/endpoint-discovery.js";

class NoteDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  weight?: number;
}

@Controller("orders")
@McpTool()
class OrdersProbeController {
  @Get(":id")
  @McpTool({ description: "Bir siparisi getirir." })
  getOrder(
    @Param("id", ParseIntPipe) _id: number,
    @Query("expand") _expand: string,
  ): string {
    return "ok";
  }

  @Post(":id/notes")
  addOrderNote(
    @Param("id", ParseIntPipe) _id: number,
    @Query("notify") _notify: boolean,
    @Headers("x-trace") _trace: string,
    @Body() _note: NoteDto,
  ): string {
    return "ok";
  }
}

describe("nest endpoint discovery", () => {
  const diagnostics: string[] = [];
  const found = discoverEndpoints(
    [{ metatype: OrdersProbeController }],
    { report: (d) => diagnostics.push(d.code) },
  );
  const byName = new Map(found.map((e) => [e.handlerName, e.descriptor]));

  it("reads routes, containers and operation ids", () => {
    expect([...byName.keys()].sort()).toEqual(["addOrderNote", "getOrder"]);
    expect(byName.get("getOrder")?.route).toBe("/orders/{id}");
    expect(byName.get("getOrder")?.container).toBe("OrdersProbeController");
    expect(byName.get("getOrder")?.method).toBe("GET");
    expect(byName.get("getOrder")?.tags).toEqual(["OrdersProbe"]);
  });

  it("derives path parameter types from pipes", () => {
    const id = byName
      .get("getOrder")
      ?.parameters?.find((p) => p.name === "id");
    expect(id).toEqual({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "integer" },
    });
  });

  it("marks query and header parameters optional", () => {
    const parameters = byName.get("addOrderNote")?.parameters ?? [];
    expect(parameters.find((p) => p.name === "notify")).toEqual({
      name: "notify",
      in: "query",
      required: false,
      schema: { type: "boolean" },
    });
    expect(parameters.find((p) => p.name === "x-trace")?.in).toBe("header");
  });

  it("binds the body through the type shape layer", () => {
    expect(byName.get("addOrderNote")?.requestBody?.schema).toEqual({
      type: "object",
      properties: {
        text: { type: "string" },
        weight: { type: "integer", minimum: 1 },
      },
      required: ["text"],
    });
  });

  it("reads the description from the decorator", () => {
    expect(byName.get("getOrder")?.description).toBe("Bir siparisi getirir.");
    expect(byName.get("addOrderNote")?.description).toBeUndefined();
  });

  it("reports nothing for a fully decorated controller", () => {
    expect(diagnostics).toEqual([]);
  });

  it("reads selection markers from both levels", () => {
    const getOrder = found.find((e) => e.handlerName === "getOrder");
    expect(getOrder?.containerMarkers).toEqual([true]);
    expect(getOrder?.operationMarkers).toEqual([true]);
  });
});
