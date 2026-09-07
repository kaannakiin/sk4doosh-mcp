import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { IsInt, IsOptional, IsString } from "class-validator";
import {
  createToolDefinition,
  SkMcpTemplateError,
  type EndpointDescriptor,
  type Fixture,
  type ToolDefinition,
} from "@sk-mcp/core";
import { describe, expect, it } from "vitest";
import { McpTool } from "../src/decorators.js";
import {
  discoverEndpoints,
  type DiscoveryOptions,
  type VisibilityDeclaration,
} from "../src/discovery/endpoint-discovery.js";

type MetadataFixture = Extract<Fixture, { kind: "metadata-extraction" }>;

function fixtures(): Array<[string, MetadataFixture]> {
  const dir = fileURLToPath(
    new URL(
      "../../../packages/conformance/metadata-extraction/",
      import.meta.url,
    ),
  );
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const fixture = JSON.parse(
        readFileSync(join(dir, file), "utf8"),
      ) as MetadataFixture;
      expect(fixture.kind).toBe("metadata-extraction");
      return [file, fixture];
    });
}

class AnonymousGuard {
  canActivate(): boolean {
    return true;
  }

  describeVisibility(): VisibilityDeclaration {
    return { anonymous: "yes", policies: [] };
  }
}

class AuthenticatedGuard {
  canActivate(): boolean {
    return true;
  }

  describeVisibility(): VisibilityDeclaration {
    return { anonymous: "no", policies: [] };
  }
}

class OrdersWriteGuard {
  canActivate(): boolean {
    return true;
  }

  describeVisibility(): VisibilityDeclaration {
    return { anonymous: "no", policies: ["OrdersWrite"] };
  }
}

class OpaqueGuard {
  canActivate(): boolean {
    return true;
  }
}

class CollidingBody {
  @IsInt()
  @IsOptional()
  id?: number;

  @IsString()
  @IsOptional()
  item?: string;
}

@Controller("import")
class ImportController {
  @Post()
  @McpTool({ description: "Kimlik listesini ice aktarir." })
  @UseGuards(AuthenticatedGuard)
  importIds(@Body() _ids: number[]): void {}
}

@Controller("orders")
class OrdersController {
  @Put(":id")
  @UseGuards(AuthenticatedGuard)
  replaceOrder(
    @Param("id", ParseIntPipe) _id: number,
    @Body() _body: CollidingBody,
  ): void {}

  @Delete(":id")
  @UseGuards(OrdersWriteGuard)
  deleteOrder(@Param("id", ParseIntPipe) _id: number): void {}

  @Patch(":id")
  @UseGuards(AuthenticatedGuard, OpaqueGuard)
  patchOrder(@Param("id", ParseIntPipe) _id: number): void {}
}

@Controller()
class RootController {
  @Get("ping")
  @UseGuards(AnonymousGuard)
  ping(): void {}

  @Head("ping")
  @UseGuards(AnonymousGuard)
  headPing(): void {}

  @Get("me")
  @UseGuards(AuthenticatedGuard)
  me(): void {}
}

const integerArrayBody: DiscoveryOptions = {
  schema: {
    typeShape: (target) =>
      (target as unknown) === Array
        ? { kind: "array", items: { kind: "scalar", scalar: "integer" } }
        : undefined,
  },
};

interface HostCase {
  readonly controller: NewableFunction;
  readonly handler: string;
  readonly options?: DiscoveryOptions;
}

const hosts: Record<string, HostCase> = {
  "array-body-becomes-body-argument.json": {
    controller: ImportController,
    handler: "importIds",
    options: integerArrayBody,
  },
  "body-property-collides-with-parameter.json": {
    controller: OrdersController,
    handler: "replaceOrder",
  },
  "delete-order.json": {
    controller: OrdersController,
    handler: "deleteOrder",
  },
  "head-ping.json": { controller: RootController, handler: "headPing" },
  "me-authenticated.json": { controller: RootController, handler: "me" },
  "patch-order.json": { controller: OrdersController, handler: "patchOrder" },
  "ping-anonymous.json": { controller: RootController, handler: "ping" },
};

const unproducible: Record<string, string> = {
  "body-with-shared-type-lifts-defs.json":
    "A query parameter whose schema is an object with $defs has no Nest binding: a named @Query('x') binds a scalar, and a whole @Query() object reports unbound_query_object.",
  "get-order-policy.json":
    "The parameter carries a description; Nest exposes no metadata source for parameter descriptions.",
  "post-order-note-with-body.json":
    "Parameter and body-member descriptions; Nest exposes no metadata source for either.",
  "put-replace-order.json":
    "The parameter carries both a parameter-level and a schema-level description; Nest exposes no metadata source for either.",
};

function discover(host: HostCase): EndpointDescriptor {
  const found = discoverEndpoints(
    [{ metatype: host.controller }],
    host.options ?? {},
  );
  const entry = found.find(
    (candidate) => candidate.handlerName === host.handler,
  );
  expect(
    entry,
    `discovery produced no endpoint for ${host.handler}`,
  ).toBeDefined();
  return entry!.descriptor;
}

function toolOf(descriptor: EndpointDescriptor, name: string): ToolDefinition {
  return createToolDefinition(descriptor, name);
}

describe("nest descriptor round-trip against metadata-extraction", () => {
  const files = fixtures();

  it("accounts for every fixture as either produced or explicitly unproducible", () => {
    const covered = [
      ...Object.keys(hosts),
      ...Object.keys(unproducible),
    ].sort();
    expect(covered).toEqual(files.map(([file]) => file));
  });

  for (const [file, fixture] of files) {
    const host = hosts[file];
    if (host === undefined) {
      it.skip(`${file} — ${unproducible[file]}`, () => {});
      continue;
    }

    it(file, () => {
      const descriptor = discover(host);
      const expected = fixture.expected;

      expect(descriptor.method).toBe(fixture.input.method);
      expect(descriptor.route).toBe(fixture.input.route);
      expect(descriptor.auth).toEqual(fixture.input.auth);
      expect(descriptor.parameters ?? []).toEqual(
        fixture.input.parameters ?? [],
      );
      expect(descriptor.requestBody).toEqual(fixture.input.requestBody);

      if ("error" in expected) {
        try {
          toolOf(descriptor, "unused");
          expect.unreachable("expected a template error");
        } catch (error) {
          expect(error).toBeInstanceOf(SkMcpTemplateError);
          expect((error as SkMcpTemplateError).code).toBe(expected.error);
        }
        return;
      }

      expect(toolOf(descriptor, expected.name)).toEqual(expected);
    });
  }
});
