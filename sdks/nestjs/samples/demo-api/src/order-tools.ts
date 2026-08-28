import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createRequestTemplate,
  type DispatchResult,
  type OuterRequest,
  type SkMcpDispatcher,
} from "@sk-mcp/sdk-nestjs";
import { z } from "zod";

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

function toToolResult(result: DispatchResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ status: result.status, body: result.body }),
      },
    ],
    isError: result.status >= 400,
  };
}

export function registerOrderTools(
  server: McpServer,
  dispatcher: SkMcpDispatcher,
  outer: OuterRequest,
) {
  server.registerTool(
    "get_order",
    {
      description: "Get an order by id.",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) =>
      toToolResult(await dispatcher.dispatch(getOrderTemplate, { id }, outer)),
  );

  server.registerTool(
    "add_order_note",
    {
      description: "Add a note to an order; optionally notify the customer.",
      inputSchema: {
        id: z.number().int(),
        text: z.string(),
        notify: z.boolean().optional(),
      },
    },
    async (args) =>
      toToolResult(
        await dispatcher.dispatch(addOrderNoteTemplate, args, outer),
      ),
  );
}
