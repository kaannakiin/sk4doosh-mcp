import type { JsonSchemaObject } from "./generated/endpoint-descriptor.js";
import type { ToolDefinition } from "./generated/tool-definition.js";
import type { VisibilityDecision } from "./visibility.js";

export const cardDescriptionBudget = 160;
export const defaultSearchLimit = 20;
export const maxSearchLimit = 50;

export interface Card {
  readonly name: string;
  readonly description: string;
  readonly parameters: string;
  readonly authUncertain?: boolean;
}

export function truncateDescription(text: string): string {
  if (text.length <= cardDescriptionBudget) {
    return text;
  }
  const cut = text.lastIndexOf(" ", cardDescriptionBudget);
  const body =
    cut > cardDescriptionBudget / 2
      ? text.slice(0, cut)
      : text.slice(0, cardDescriptionBudget);
  return `${body}…`;
}

export function summarizeParameters(inputSchema: JsonSchemaObject): string {
  const properties = inputSchema.properties;
  if (properties === undefined) {
    return "";
  }
  const required = new Set(inputSchema.required ?? []);
  const parts: string[] = [];
  for (const [name, schema] of Object.entries(properties)) {
    const type = typeLabel(schema);
    parts.push(
      required.has(name) ? `${name}: ${type} (required)` : `${name}: ${type}`,
    );
  }
  return parts.join(", ");
}

export function createCard(
  tool: ToolDefinition,
  decision: VisibilityDecision = "allow",
): Card {
  const card: Card = {
    name: tool.name,
    description: truncateDescription(tool.description),
    parameters: summarizeParameters(tool.inputSchema),
  };
  return decision === "unknown" ? { ...card, authUncertain: true } : card;
}

function typeLabel(schema: JsonSchemaObject): string {
  const type = schema.type;
  if (typeof type === "string") {
    return type;
  }
  if (Array.isArray(type)) {
    const named = type.find((candidate) => candidate !== "null");
    if (named !== undefined) {
      return named;
    }
  }
  return "any";
}
