export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: ToolAnnotations;
  auth: Auth;
}
export interface JsonSchemaObject {
  [k: string]: unknown;
}
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}
export interface Auth {
  anonymous: boolean;
  policies: string[];
}
