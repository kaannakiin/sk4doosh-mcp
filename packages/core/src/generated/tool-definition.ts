export type Anonymity = "yes" | "no" | "unknown";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: ToolAnnotations;
  auth: Auth;
}
export interface JsonSchemaObject {
  type?:
    | ("object" | "array" | "string" | "integer" | "number" | "boolean" | "null")
    | ("object" | "array" | "string" | "integer" | "number" | "boolean" | "null")[];
  description?: string;
  format?: string;
  properties?: {
    [k: string]: JsonSchemaObject;
  };
  required?: string[];
  items?: JsonSchemaObject;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchemaObject;
  [k: string]: unknown;
}
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}
export interface Auth {
  anonymous: Anonymity;
  policies: string[];
  imperative: boolean;
}
