export type Fixture =
  | NamingFixture
  | MetadataExtractionFixture
  | ArgumentMappingFixture
  | SelectionFixture
  | VisibilityFixture
  | SearchFixture
  | ErrorMappingFixture;
export type PrefixMode = "always" | "onCollision";
export type Anonymity = "yes" | "no" | "unknown";
export type InvokeResult = InvokeSuccess | MappedError;
export type BackendErrorCode =
  | "validation_failed"
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "backend_error"
  | "backend_unavailable";

export interface NamingFixture {
  kind: "naming";
  description: string;
  input: {
    endpoints: [NamingEndpoint, ...NamingEndpoint[]];
    prefixMode?: PrefixMode;
    hostPrefixes?: {
      [k: string]: string;
    };
  };
  expected: NamingExpectedNames | NamingExpectedError;
}
export interface NamingEndpoint {
  operationId?: string;
  container?: string;
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  route: string;
  containerPrefix?: string;
  toolName?: string;
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
  expected: ToolDefinition | MetadataExtractionExpectedError;
}
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
export interface MetadataExtractionExpectedError {
  error: "argument_collision";
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
  error:
    | "unknown_argument"
    | "invalid_path_type"
    | "missing_path_parameter"
    | "header_injection"
    | "null_not_allowed"
    | "invalid_type";
}
export interface SelectionFixture {
  kind: "selection";
  description: string;
  input: {
    default: "include" | "exclude";
    operations: [SelectionOperation, ...SelectionOperation[]];
  };
  expected: SelectionExpectedIds | SelectionExpectedError;
}
export interface SelectionOperation {
  id: string;
  container?: "include" | "exclude" | "both";
  operation?: "include" | "exclude" | "both";
}
export interface SelectionExpectedIds {
  selected: string[];
}
export interface SelectionExpectedError {
  error: "ambiguous_selection";
}
export interface VisibilityFixture {
  kind: "visibility";
  description: string;
  input: {
    auth: Auth;
    caller: CallerFacts;
  };
  expected: VisibilityExpectation;
}
export interface CallerFacts {
  identity: "present" | "absent" | "unknown";
  policyResults?: {
    [k: string]: "allow" | "deny" | "unknown";
  };
}
export interface VisibilityExpectation {
  decision: "allow" | "deny" | "unknown";
}
export interface SearchFixture {
  kind: "search";
  description: string;
  input: {
    tools: [SearchTool, ...SearchTool[]];
    query: string;
    limit?: number;
  };
  expected: SearchExpectation;
}
export interface SearchTool {
  name: string;
  description?: string;
  tags?: string[];
  route: string;
}
export interface SearchExpectation {
  names: string[];
}
export interface ErrorMappingFixture {
  kind: "error-mapping";
  description: string;
  input: BackendResponseSpec;
  expected: InvokeResult;
}
export interface BackendResponseSpec {
  status: number;
  contentType?: string;
  headers?: {
    [k: string]: string;
  };
  body?: string | {} | unknown[];
  knownFields?: string[];
}
export interface InvokeSuccess {
  status: number;
  body?: unknown;
  contentType?: string;
  location?: string;
}
export interface MappedError {
  error: BackendErrorCode;
  message: string;
  status: number;
  retryable: boolean;
  fields?: FieldError[];
  retryAfterSeconds?: number;
  reference?: string;
}
export interface FieldError {
  name?: string;
  message: string;
}
