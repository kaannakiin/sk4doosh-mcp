import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createRequestTemplate,
  isMappedError,
  type DispatchResult,
  type InvokeResultMapper,
  type OuterRequest,
  type SkMcpDispatcher,
} from "@sk-mcp/sdk-nestjs";
import { z } from "zod";

const createOrderShape = {
  item: z.string(),
  quantity: z.number().int().min(1).max(100),
};
const getOrderShape = { id: z.number().int() };
const addOrderNoteShape = {
  id: z.number().int(),
  text: z.string(),
  notify: z.boolean().optional(),
};

const createOrderTemplate = createRequestTemplate({
  method: "POST",
  route: "/orders",
  parameters: [],
  bodyProperties: ["item", "quantity"],
});

const getOrderTemplate = createRequestTemplate({
  method: "GET",
  route: "/orders/{id}",
  parameters: [{ name: "id", location: "path", kind: "integer" }],
});

const addOrderNoteTemplate = createRequestTemplate({
  method: "POST",
  route: "/orders/{id}/notes",
  parameters: [
    { name: "id", location: "path", kind: "integer" },
    { name: "notify", location: "query", kind: "boolean" },
  ],
  bodyProperties: ["text"],
});

interface RequestInfoLike {
  readonly requestInfo?: {
    readonly headers: Record<string, string | string[] | undefined>;
  };
}

function outerFromExtra(extra: RequestInfoLike): OuterRequest {
  return {
    headers: (extra.requestInfo?.headers ?? {}) as OuterRequest["headers"],
  };
}

function toToolResult(
  mapper: InvokeResultMapper,
  result: DispatchResult,
  knownFields: readonly string[],
) {
  const outcome = mapper.map(result, knownFields);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(outcome) }],
    isError: isMappedError(outcome),
  };
}

export function registerOrderTools(
  server: McpServer,
  dispatcher: SkMcpDispatcher,
  mapper: InvokeResultMapper,
): void {
  server.registerTool(
    "create_order",
    {
      description: "Create an order for an item and quantity.",
      inputSchema: createOrderShape,
    },
    async (args, extra) =>
      toToolResult(
        mapper,
        await dispatcher.dispatch(
          createOrderTemplate,
          args,
          outerFromExtra(extra),
        ),
        Object.keys(createOrderShape),
      ),
  );

  server.registerTool(
    "get_order",
    {
      description: "Get an order by id.",
      inputSchema: getOrderShape,
    },
    async ({ id }, extra) =>
      toToolResult(
        mapper,
        await dispatcher.dispatch(
          getOrderTemplate,
          { id },
          outerFromExtra(extra),
        ),
        Object.keys(getOrderShape),
      ),
  );

  server.registerTool(
    "add_order_note",
    {
      description: "Add a note to an order; optionally notify the customer.",
      inputSchema: addOrderNoteShape,
    },
    async (args, extra) =>
      toToolResult(
        mapper,
        await dispatcher.dispatch(
          addOrderNoteTemplate,
          args,
          outerFromExtra(extra),
        ),
        Object.keys(addOrderNoteShape),
      ),
  );
}
