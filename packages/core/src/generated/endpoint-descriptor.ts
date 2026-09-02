export type Anonymity = "yes" | "no" | "unknown";

export interface EndpointDescriptor {
  operationId?: string;
  container?: string;
  containerPrefix?: string;
  toolName?: string;
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  route: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: {
    [k: string]: ResponseBody;
  };
  auth: Auth;
  tags?: string[];
}
export interface Parameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JsonSchemaObject;
  description?: string;
}
export interface JsonSchemaObject {
  [k: string]: unknown;
}
export interface RequestBody {
  schema: JsonSchemaObject;
  description?: string;
}
export interface ResponseBody {
  schema?: JsonSchemaObject;
  description?: string;
}
export interface Auth {
  anonymous: Anonymity;
  policies: string[];
  imperative: boolean;
}
