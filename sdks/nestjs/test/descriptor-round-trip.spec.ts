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
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { IsBoolean, IsInt, IsOptional, IsString } from "class-validator";
import {
  createRequestTemplateFromEndpoint,
  createToolDefinition,
  expandToolProductions,
  SkMcpTemplateError,
  type EndpointDescriptor,
  type FileOptions,
  type Fixture,
  type ToolDefinition,
} from "@sk-mcp/core";
import { describe, expect, it } from "vitest";
import { cleanTags, declaredDescriptor, toCuration } from "../src/catalog.js";
import { curate, hidden, McpTool, McpVariant } from "../src/decorators.js";
import {
  discoverEndpoints,
  type DiscoveryOptions,
  type VisibilityDeclaration,
} from "../src/discovery/endpoint-discovery.js";

type MetadataFixture = Extract<Fixture, { kind: "metadata-extraction" }>;

function fixtures(): Array<[string, MetadataFixture]> {
  const dir = fileURLToPath(
    new URL(
      "../../../packages/http/conformance/metadata-extraction/",
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

class OrdersReadGuard {
  canActivate(): boolean {
    return true;
  }

  describeVisibility(): VisibilityDeclaration {
    return { anonymous: "no", policies: ["OrdersRead"] };
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

class CollidingRootBody {
  @IsString()
  @IsOptional()
  body?: string;

  @IsString()
  @IsOptional()
  item?: string;
}

class CancelBody {
  @IsString()
  reason!: string;
}

class MessageBody {
  @IsString()
  body!: string;
}

class TicketBody {
  @IsString()
  title!: string;
}

class NoteBody {
  @IsString()
  @IsOptional()
  text?: string;
}

class TicketPatchBody {
  @IsString()
  @IsOptional()
  status?: string;
}

class TicketFormBody {
  @IsString()
  title!: string;

  @IsInt()
  @IsOptional()
  priority?: number;
}

@Controller("tickets")
class TicketsController {
  @Post()
  @McpTool({
    description: "Opens a ticket.",
    files: {
      attachment: {
        mediaType: "text/csv",
        description: "The ticket's attachment.",
      },
    },
  })
  @UseInterceptors(FileInterceptor("attachment"))
  @UseGuards(AuthenticatedGuard)
  createTicket(
    @UploadedFile() _attachment: unknown,
    @Body() _body: TicketBody,
  ): void {}

  @Post()
  @McpTool({
    description: "Opens a ticket.",
    files: { attachments: { multiple: true } },
  })
  @UseInterceptors(FilesInterceptor("attachments"))
  @UseGuards(AuthenticatedGuard)
  createTicketWithAttachments(@UploadedFiles() _attachments: unknown): void {}

  @Post()
  @McpTool({
    description: "Opens a ticket.",
    consumes: "application/x-www-form-urlencoded",
  })
  @UseGuards(AuthenticatedGuard)
  createTicketFromForm(@Body() _body: TicketFormBody): void {}

  @Patch()
  @McpTool({
    description: "Opens a ticket.",
    consumes: "application/merge-patch+json",
  })
  @UseGuards(AuthenticatedGuard)
  patchTicket(@Body() _body: TicketPatchBody): void {}

  @Post()
  @McpTool({ description: "Opens a ticket.", consumes: "text/plain" })
  @UseGuards(AuthenticatedGuard)
  addNote(@Body() _body: string): void {}

  @Post()
  @McpTool({ description: "Opens a ticket.", consumes: "text/plain" })
  @UseGuards(AuthenticatedGuard)
  addStructuredNote(@Body() _body: NoteBody): void {}
}

@Controller("messages")
class MessagesController {
  @Post()
  @McpTool({ description: "Mesaj gonderir.", bodyRequired: false })
  @UseGuards(AuthenticatedGuard)
  sendMessage(@Body() _body: MessageBody): void {}
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

  @Put(":body/bulk")
  @UseGuards(AuthenticatedGuard)
  replaceOrderBody(
    @Param("body") _body: string,
    @Body() _payload: CollidingRootBody,
  ): void {}

  @Delete(":id")
  @UseGuards(OrdersWriteGuard)
  deleteOrder(@Param("id", ParseIntPipe) _id: number): void {}

  @Patch(":id")
  @UseGuards(AuthenticatedGuard, OpaqueGuard)
  patchOrder(@Param("id", ParseIntPipe) _id: number): void {}

  @Post("cancel")
  @McpTool({ description: "Siparisi iptal eder.", bodyRequired: false })
  @UseGuards(AuthenticatedGuard)
  cancelOrder(@Body() _body: CancelBody): void {}
}

class PingBody {
  @IsBoolean()
  @IsOptional()
  pong?: boolean;
}

class OrderSummary {
  @IsInt()
  @IsOptional()
  id?: number;
}

class OrderView {
  @IsInt()
  @IsOptional()
  id?: number;

  @IsString()
  @IsOptional()
  item?: string;
}

class CreatedOrder {
  @IsInt()
  @IsOptional()
  createdId?: number;
}

class RebuildError {
  @IsString()
  @IsOptional()
  error?: string;
}

class UpsertOrderBody {
  @IsString()
  item!: string;
}

@Controller()
class RootController {
  @Get("ping")
  @McpTool({ responses: { 200: PingBody } })
  @UseGuards(AnonymousGuard)
  ping(): void {}

  @Head("ping")
  @UseGuards(AnonymousGuard)
  headPing(): void {}

  @Get("me")
  @McpTool({
    responses: {
      200: {
        schema: {
          type: "object",
          properties: { name: { type: ["string", "null"] } },
        },
      },
    },
  })
  @UseGuards(AuthenticatedGuard)
  me(): void {}
}

@Controller("orders")
class OrderResponsesController {
  @Get()
  @McpTool({
    description: "Siparisleri listeler.",
    responses: { 200: [OrderSummary] },
  })
  @UseGuards(OrdersReadGuard)
  listOrders(): void {}

  @Get("search")
  @McpTool({
    description: "Siparisleri arar.",
    responses: {
      200: {
        schema: {
          type: "array",
          items: { $ref: "#/$defs/Order" },
          $defs: {
            Order: { type: "object", properties: { id: { type: "integer" } } },
          },
        },
      },
    },
  })
  @UseGuards(OrdersReadGuard)
  searchOrders(): void {}

  @Delete(":id")
  @McpTool({
    description: "Bir siparisi siler.",
    responses: { 204: {}, 404: {} },
  })
  @UseGuards(OrdersWriteGuard)
  deleteOrder(@Param("id", ParseIntPipe) _id: number): void {}

  @Put(":id")
  @McpTool({
    description: "Bir siparisi olusturur ya da gunceller.",
    responses: { 201: CreatedOrder, 200: OrderView },
  })
  @UseGuards(OrdersWriteGuard)
  upsertOrder(
    @Param("id", ParseIntPipe) _id: number,
    @Body() _body: UpsertOrderBody,
  ): void {}
}

@Controller("index")
class IndexController {
  @Post("rebuild")
  @McpTool({
    description: "Arama indeksini yeniden kurar.",
    responses: { 400: RebuildError, 500: {} },
  })
  @UseGuards(OrdersWriteGuard)
  rebuildIndex(): void {}
}

class CurationListQuery {
  @IsString()
  customerId!: string;

  @IsInt()
  @IsOptional()
  page?: number;
}

class CurationHideQuery {
  @IsString()
  customerId!: string;

  @IsString()
  @IsOptional()
  status?: string;
}

class CurationStatusQuery {
  @IsString()
  @IsOptional()
  status?: string;
}

class CurationRenameCollisionQuery {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  state?: string;
}

class CurationVariantQuery {
  @IsString()
  @IsOptional()
  q?: string;

  @IsString()
  @IsOptional()
  status?: string;
}

class CurationSourceBody {
  @IsString()
  item!: string;

  @IsString()
  source!: string;
}

class CurationItemBody {
  @IsString()
  item!: string;

  @IsInt()
  quantity!: number;
}

@Controller("orders")
class TagsController {
  @Get()
  @McpTool({ description: "Lists orders.", tags: ["billing", "orders"] })
  @UseGuards(AnonymousGuard)
  declaredTags(): void {}
}

@Controller("orders")
class CurationController {
  @Get()
  @McpTool({
    description: "Lists orders.",
    arguments: curate<CurationListQuery>({ page: { as: "page_number" } }),
  })
  @UseGuards(AnonymousGuard)
  renamePage(@Query() _query: CurationListQuery): void {}

  @Get()
  @McpTool({
    description: "Lists orders.",
    arguments: curate<CurationHideQuery>({
      customerId: hidden.from("tenant"),
    }),
  })
  @UseGuards(AnonymousGuard)
  hideCustomer(@Query() _query: CurationHideQuery): void {}

  @Get()
  @McpTool({ arguments: { statuz: { as: "state" } } })
  @UseGuards(AnonymousGuard)
  curateMissing(@Query() _query: CurationStatusQuery): void {}

  @Get()
  @McpTool({
    arguments: curate<CurationRenameCollisionQuery>({
      state: { as: "status" },
    }),
  })
  @UseGuards(AnonymousGuard)
  renameOntoSibling(@Query() _query: CurationRenameCollisionQuery): void {}

  @Get(":id")
  @McpTool({ arguments: { id: hidden.omit() } })
  @UseGuards(AnonymousGuard)
  omitPathParameter(@Param("id", ParseIntPipe) _id: number): void {}

  @Post()
  @McpTool({
    description: "Creates an order.",
    arguments: curate<CurationSourceBody>({
      source: hidden.value("agent"),
    }),
  })
  @UseGuards(AnonymousGuard)
  hideBodyField(@Body() _body: CurationSourceBody): void {}

  @Post()
  @McpTool({
    description: "Creates an order.",
    arguments: curate<CurationItemBody>({ item: { as: "item_name" } }),
  })
  @UseGuards(AnonymousGuard)
  renameBodyField(@Body() _body: CurationItemBody): void {}

  @Post("tags")
  @McpTool({ arguments: { tag: hidden.omit() } })
  @UseGuards(AnonymousGuard)
  curateBodyRootField(@Body() _tags: string[]): void {}

  @Get()
  @McpTool({ name: "list_orders" })
  @McpVariant({ name: "find_orders", description: "Searches orders." })
  @UseGuards(AnonymousGuard)
  nameAndVariants(): void {}

  @Get()
  @McpTool({ description: "Lists orders." })
  @McpVariant({
    name: "find_open_orders",
    description: "Searches orders that are still open.",
    arguments: { status: hidden.value("open") },
  })
  @McpVariant({
    name: "find_all_orders",
    description: "Searches orders in any state.",
  })
  @UseGuards(AnonymousGuard)
  twoVariants(@Query() _query: CurationVariantQuery): void {}

  @Get()
  @McpTool({
    description: "Lists orders.",
    arguments: curate<CurationStatusQuery>({ status: hidden.value("open") }),
  })
  @McpVariant({
    name: "find_open_orders",
    description: "Searches orders that are still open.",
  })
  @McpVariant({
    name: "find_all_orders",
    description: "Searches orders in any state.",
    arguments: { status: {} },
  })
  @UseGuards(AnonymousGuard)
  variantResetsRecord(@Query() _query: CurationStatusQuery): void {}
}

const integerArrayBody: DiscoveryOptions = {
  schema: {
    typeShape: (target) =>
      (target as unknown) === Array
        ? { kind: "array", items: { kind: "scalar", scalar: "integer" } }
        : undefined,
  },
};

const stringArrayBody: DiscoveryOptions = {
  schema: {
    typeShape: (target) =>
      (target as unknown) === Array
        ? { kind: "array", items: { kind: "scalar", scalar: "string" } }
        : undefined,
  },
};

interface HostCase {
  readonly controller: NewableFunction;
  readonly handler: string;
  readonly options?: DiscoveryOptions;
  readonly files?: FileOptions;
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
  "body-root-name-collides-with-parameter.json": {
    controller: OrdersController,
    handler: "replaceOrderBody",
  },
  "delete-order.json": {
    controller: OrdersController,
    handler: "deleteOrder",
  },
  "head-ping.json": { controller: RootController, handler: "headPing" },
  "list-orders-array-response.json": {
    controller: OrderResponsesController,
    handler: "listOrders",
  },
  "search-orders-response-defs.json": {
    controller: OrderResponsesController,
    handler: "searchOrders",
  },
  "delete-order-no-content.json": {
    controller: OrderResponsesController,
    handler: "deleteOrder",
  },
  "upsert-order-prefers-200.json": {
    controller: OrderResponsesController,
    handler: "upsertOrder",
  },
  "rebuild-index-no-success-response.json": {
    controller: IndexController,
    handler: "rebuildIndex",
  },
  "me-authenticated.json": { controller: RootController, handler: "me" },
  "patch-order.json": { controller: OrdersController, handler: "patchOrder" },
  "ping-anonymous.json": { controller: RootController, handler: "ping" },
  "optional-object-body-becomes-body-argument.json": {
    controller: OrdersController,
    handler: "cancelOrder",
  },
  "declared-tags-replace-container-tag.json": {
    controller: TagsController,
    handler: "declaredTags",
  },
  "curated-rename-keeps-position.json": {
    controller: CurationController,
    handler: "renamePage",
  },
  "hidden-parameter-leaves-schema.json": {
    controller: CurationController,
    handler: "hideCustomer",
  },
  "curation-unresolved-drops-endpoint.json": {
    controller: CurationController,
    handler: "curateMissing",
  },
  "rename-collision-drops-endpoint.json": {
    controller: CurationController,
    handler: "renameOntoSibling",
  },
  "omit-on-required-path-parameter-drops-endpoint.json": {
    controller: CurationController,
    handler: "omitPathParameter",
  },
  "hidden-body-field-drops-required.json": {
    controller: CurationController,
    handler: "hideBodyField",
  },
  "renamed-required-body-field-keeps-required.json": {
    controller: CurationController,
    handler: "renameBodyField",
  },
  "curation-on-body-root-field-unresolved.json": {
    controller: CurationController,
    handler: "curateBodyRootField",
    options: stringArrayBody,
  },
  "tool-name-and-variants-conflict.json": {
    controller: CurationController,
    handler: "nameAndVariants",
  },
  "variants-produce-two-tools.json": {
    controller: CurationController,
    handler: "twoVariants",
  },
  "variant-record-replaces-base-record.json": {
    controller: CurationController,
    handler: "variantResetsRecord",
  },
  "optional-body-with-body-field-nests.json": {
    controller: MessagesController,
    handler: "sendMessage",
  },
  "multipart-file-field-becomes-file-argument.json": {
    controller: TicketsController,
    handler: "createTicket",
  },
  "multipart-file-argument-offers-ref-when-a-resolver-is-bound.json": {
    controller: TicketsController,
    handler: "createTicket",
    files: {
      refDescription: "An attachment id returned by upload_attachment.",
    },
  },
  "multipart-file-array-becomes-array-of-file-arguments.json": {
    controller: TicketsController,
    handler: "createTicketWithAttachments",
  },
  "form-urlencoded-publishes-fields-like-json.json": {
    controller: TicketsController,
    handler: "createTicketFromForm",
  },
  "json-family-content-type-does-not-change-the-tool.json": {
    controller: TicketsController,
    handler: "patchTicket",
  },
  "text-plain-body-is-a-string-argument.json": {
    controller: TicketsController,
    handler: "addNote",
  },
  "text-plain-object-body-rejected.json": {
    controller: TicketsController,
    handler: "addStructuredNote",
  },
};

const unproducible: Record<string, string> = {
  "body-with-shared-type-lifts-defs.json":
    "A query parameter whose schema is an object with $defs has no Nest binding: a named @Query('x') binds a scalar, and a whole @Query() object reports unbound_query_object.",
  "body-root-defs-conflict-drops-endpoint.json":
    "Same as above: the conflicting bag lives on a query parameter, which Nest cannot bind as an object with $defs.",
  "body-root-defs-are-merged.json":
    "The body root's $defs holds a single-use type; hoisting only fires for a type used more than once or in a cycle, so the binder inlines it instead.",
  "body-root-oneof-stops-flattening.json":
    "A body root carrying oneOf: the type-shape binder writes object roots with properties and required only, and class-validator has no discriminated-union decorator. Reachable through options.schema.typeShape alone.",
  "body-root-property-names-stops-flattening.json":
    "An integer-keyed dictionary body: @Body() over a Record gives the binder no readable key type, so it never emits propertyNames.",
  "body-root-nullable-type-stops-flattening.json":
    'type as ["object","null"]: TypeScript has no runtime nullability, so the IR carries no nullable node (schema-conversion-rules.md, Unpinned areas).',
  "body-root-ref-only-is-wrapped.json":
    "A bare $ref body root: simplifySchema always writes the root inline, so no SDK emits one. It exists to pin the rule for hand-written descriptors and host schema hooks.",
  "body-root-anchor-stops-flattening.json":
    "$anchor on a body root: the type-shape binder addresses hoisted types as #/$defs/<name> and never emits a plain-name fragment.",
  "body-root-id-stops-flattening.json":
    "$id on a body root: the binder writes no schema resource boundary, so only a host-supplied verbatim schema carries one.",
  "body-root-annotations-still-flatten.json":
    "$schema and title on a body root: the binder writes neither, so only a host-supplied verbatim schema carries them.",
  "typed-additional-properties-survive.json":
    "A body with both properties and a typed additionalProperties: a decorated DTO yields the first and a Record yields the second, never both in one root.",
  "get-order-policy.json":
    "The parameter carries a description; Nest exposes no metadata source for parameter descriptions.",
  "post-order-note-with-body.json":
    "Parameter and body-member descriptions; Nest exposes no metadata source for either.",
  "put-replace-order.json":
    "The parameter carries both a parameter-level and a schema-level description; Nest exposes no metadata source for either.",
  "curated-description-overrides-schema.json":
    "The parameter carries a parameter-level description that the curation description has to override; Nest exposes no metadata source for parameter descriptions.",
  "curation-on-folded-route-is-spared.json":
    "The subject is route folding, which is a property of an operation's set of routes and not of one descriptor; this round-trip builds a single descriptor and has nothing to fold.",
  "hidden-argument-defs-are-not-lifted.json":
    "A query parameter whose schema is a $ref beside its own $defs: query parameters are bound from scalar DTO members, so no parameter schema the binder emits carries a bag.",
  "multipart-root-mode-replaces-file-inside-body.json":
    "The body collides with a path parameter named 'id'; a Nest DTO member and a route placeholder of one name is exactly the collision, but the binder emits the placeholder as a string without a pipe and the fixture pins an integer path.",
  "form-file-in-urlencoded-rejected.json":
    "Nest refuses a file binding under a urlencoded media type at discovery (content_type_not_accepted), before any descriptor exists; the template rule is pinned for hand-written descriptors.",
  "form-two-level-nesting-rejected.json":
    "The binder hoists a nested DTO into $defs and discovery inlines one level only, so the descriptor carries a $ref where the fixture pins an inline second level.",
  "form-array-of-objects-rejected.json":
    "An array-of-DTO member reaches the descriptor as an items $ref into $defs, not the inline object the fixture pins.",
  "json-patch-document-is-an-operation-array.json":
    "Nest has no JSON Patch document type; the operation array is the ASP.NET Core binding of JsonPatchDocument<T>.",
  "form-free-form-body-rejected.json":
    "A decorated DTO never carries additionalProperties beside its properties; only a host-supplied verbatim schema does.",
  "form-structural-member-name-rejected.json":
    "A member named 'a.b' is not a legal TypeScript property a class-validator DTO can declare without a verbatim schema.",
  "unknown-media-type-rejected.json":
    "Nest refuses a media type it has no writer for at discovery (unsupported_binding), before any descriptor exists; the template rule is pinned for hand-written descriptors.",
};

function discover(host: HostCase): {
  readonly descriptor: EndpointDescriptor;
  readonly declaresTags: boolean;
} {
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
  const declared = entry!.hints.tags;
  return {
    descriptor: declaredDescriptor(
      entry!,
      toCuration(entry!.hints.arguments ?? {}),
      declared === undefined
        ? undefined
        : cleanTags(declared, host.handler, () => {}),
    ),
    declaresTags: declared !== undefined,
  };
}

function toolOf(
  descriptor: EndpointDescriptor,
  name: string,
  files?: FileOptions,
): ToolDefinition {
  return createToolDefinition(descriptor, name, undefined, undefined, files);
}

function toolsOf(
  descriptor: EndpointDescriptor,
  files?: FileOptions,
): ToolDefinition[] {
  return expandToolProductions([descriptor], (e) => e).map((production) => {
    const tool = createToolDefinition(
      production.endpoint,
      undefined,
      production.variant,
      undefined,
      files,
    );
    if (production.endpoint.requestBody?.contentType !== undefined) {
      createRequestTemplateFromEndpoint(
        production.endpoint,
        production.variant,
        undefined,
        files,
      );
    }
    return tool;
  });
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
      const { descriptor, declaresTags } = discover(host);
      const expected = fixture.expected;

      expect(descriptor.method).toBe(fixture.input.method);
      expect(descriptor.route).toBe(fixture.input.route);
      expect(descriptor.auth).toEqual(fixture.input.auth);
      expect(descriptor.parameters ?? []).toEqual(
        fixture.input.parameters ?? [],
      );
      expect(descriptor.requestBody).toEqual(fixture.input.requestBody);
      expect(descriptor.responses ?? {}).toEqual(fixture.input.responses ?? {});
      expect(descriptor.arguments ?? []).toEqual(fixture.input.arguments ?? []);
      expect(descriptor.variants ?? []).toEqual(fixture.input.variants ?? []);
      /**
       * Guard: gated on the host declaring tags, not on the fixture carrying them. Seven fixtures
       * carry illustrative `tags` that no Nest controller could produce — discovery derives the
       * tag from the container's class name — so comparing whenever the fixture has the field
       * would fail them over a fact none of them is about.
       */
      if (declaresTags) {
        expect(descriptor.tags).toEqual(fixture.input.tags);
      }

      if ("error" in expected) {
        try {
          toolsOf(descriptor, host.files);
          expect.unreachable("expected a template error");
        } catch (error) {
          expect(error).toBeInstanceOf(SkMcpTemplateError);
          expect((error as SkMcpTemplateError).code).toBe(expected.error);
        }
        return;
      }

      if ("tools" in expected) {
        expect(toolsOf(descriptor, host.files)).toEqual(expected.tools);
        return;
      }

      expect(toolOf(descriptor, expected.name, host.files)).toEqual(expected);
    });
  }
});
