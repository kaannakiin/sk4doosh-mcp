export type Fixture = NamingFixture | MetadataExtractionFixture | ArgumentMappingFixture;

export interface NamingFixture {
  kind: "naming";
  description: string;
  input: {
    endpoints: [NamingEndpoint, ...NamingEndpoint[]];
  };
  expected: NamingExpectedNames | NamingExpectedError;
}
export interface NamingEndpoint {
  operationId?: string;
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  route: string;
}
export interface NamingExpectedNames {
  names: [string, ...string[]];
}
export interface NamingExpectedError {
  error: "name_collision" | "invalid_name";
}
export interface MetadataExtractionFixture {
  kind: "metadata-extraction";
  description: string;
  input: EndpointDescriptor;
  expected: ToolDefinition;
}
export interface EndpointDescriptor {
  operationId?: string;
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
  anonymous: boolean;
  policies: string[];
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: ToolAnnotations;
  auth: Auth;
}
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}
export interface ArgumentMappingFixture {
  kind: "argument-mapping";
  description: string;
  input: {
    template: RequestTemplateSpec;
    arguments: {};
  };
  expected: ComposedRequestExpectation | ArgumentMappingError;
}
export interface RequestTemplateSpec {
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  route: string;
  parameters?: TemplateParameter[];
  body?: {
    properties: string[];
    additionalProperties?: boolean;
  };
}
export interface TemplateParameter {
  name: string;
  in: "path" | "query" | "header";
  type: "string" | "integer" | "number" | "boolean";
  array?: boolean;
}
export interface ComposedRequestExpectation {
  pathAndQuery: string;
  headers?: {
    [k: string]: string;
  };
  bodyJson?: {};
}
export interface ArgumentMappingError {
  error: "unknown_argument" | "invalid_path_type" | "missing_path_parameter" | "header_injection" | "null_not_allowed";
}
