export type Fixture =
  | NamingFixture
  | MetadataExtractionFixture
  | ArgumentMappingFixture
  | SelectionFixture
  | VisibilityFixture
  | SearchFixture
  | ErrorMappingFixture
  | SchemaSimplificationFixture
  | CardFixture;
export type ArgumentFill = (
  | {
      kind: "constant";
      value: unknown;
      source?: never;
    }
  | {
      kind: "deferred";
      source: unknown;
      value?: never;
    }
  | {
      kind: "omit";
      value?: never;
      source?: never;
    }
) & {
  kind: ArgumentFillKind;
  value?: unknown;
  source?: string;
};
export type ArgumentFillKind = "constant" | "deferred" | "omit";
export type PrefixMode = "always" | "onCollision";
export type Anonymity = "yes" | "no" | "unknown";
export type ArgumentFill1 = (
  | {
      kind: "constant";
      value: unknown;
      source?: never;
    }
  | {
      kind: "deferred";
      source: unknown;
      value?: never;
    }
  | {
      kind: "omit";
      value?: never;
      source?: never;
    }
) & {
  kind: ArgumentFillKind;
  value?: unknown;
  source?: string;
};
export type ArgumentFill2 = (
  | {
      kind: "constant";
      value: unknown;
      source?: never;
    }
  | {
      kind: "deferred";
      source: unknown;
      value?: never;
    }
  | {
      kind: "omit";
      value?: never;
      source?: never;
    }
) & {
  kind: ArgumentFillKind;
  value?: unknown;
  source?: string;
};
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
export type TypeKind =
  | "scalar"
  | "binary"
  | "enum"
  | "map"
  | "array"
  | "ref"
  | "verbatim"
  | "unknown";
export type ScalarKind = "string" | "boolean" | "integer" | "number";
export type EnumWireForm = "string" | "integer" | "unresolved";
export type SchemaDiagnosticCode =
  | "unsupported_dictionary_key"
  | "schema_def_name_disambiguated"
  | "schema_depth_truncated"
  | "unreadable_shape";

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
  variants?: [ToolVariant, ...ToolVariant[]];
}
export interface ToolVariant {
  name: string;
  description: string;
  arguments?: ArgumentCuration[];
}
export interface ArgumentCuration {
  name: string;
  as?: string;
  description?: string;
  hidden?: ArgumentFill;
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
  foldedRoutes?: [string, ...string[]];
  expected:
    | ToolDefinition
    | MetadataExtractionExpectedTools
    | MetadataExtractionExpectedError;
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
  arguments?: ArgumentCuration[];
  variants?: [ToolVariant, ...ToolVariant[]];
}
export interface Parameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JsonSchemaObject;
  style?: "form" | "spaceDelimited" | "pipeDelimited";
  explode?: boolean;
  description?: string;
}
export interface JsonSchemaObject {
  type?:
    | (
        | "object"
        | "array"
        | "string"
        | "integer"
        | "number"
        | "boolean"
        | "null"
      )
    | (
        | "object"
        | "array"
        | "string"
        | "integer"
        | "number"
        | "boolean"
        | "null"
      )[];
  description?: string;
  format?: string;
  properties?: {
    [k: string]: JsonSchemaObject;
  };
  required?: string[];
  items?: JsonSchemaObject;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchemaObject;
  contentEncoding?: string;
  propertyNames?: JsonSchemaObject;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  anyOf?: JsonSchemaObject[];
  $ref?: string;
  $defs?: {
    [k: string]: JsonSchemaObject;
  };
  [k: string]: unknown;
}
export interface RequestBody {
  schema: JsonSchemaObject;
  required?: boolean;
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
  outputSchema?: JsonSchemaObject;
  annotations: ToolAnnotations;
  auth: Auth;
}
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}
export interface MetadataExtractionExpectedTools {
  tools: [ToolDefinition, ...ToolDefinition[]];
}
export interface MetadataExtractionExpectedError {
  error:
    | "argument_collision"
    | "schema_def_conflict"
    | "duplicate_argument"
    | "curation_unresolved"
    | "invalid_fill_constant"
    | "hidden_required_omitted"
    | "variant_declaration_conflict";
}
export interface ArgumentMappingFixture {
  kind: "argument-mapping";
  description: string;
  input: {
    template: RequestTemplateSpec;
    arguments: {};
    deferred?: {};
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
    curation?: TemplateBodyCuration[];
  };
  bodyRoot?: string;
  rootFill?: ArgumentFill2;
}
export interface TemplateParameter {
  name: string;
  in: "path" | "query" | "header";
  type: "string" | "integer" | "number" | "boolean";
  array?: boolean;
  style?: "form" | "spaceDelimited" | "pipeDelimited";
  explode?: boolean;
  as?: string;
  fill?: ArgumentFill1;
}
export interface TemplateBodyCuration {
  name: string;
  as?: string;
  fill?: ArgumentFill;
}
export interface ComposedRequestExpectation {
  pathAndQuery: string;
  headers?: {
    [k: string]: string;
  };
  bodyJson?: {} | unknown[] | string | number | boolean;
}
export interface ArgumentMappingError {
  error:
    | "unknown_argument"
    | "invalid_path_type"
    | "missing_path_parameter"
    | "header_injection"
    | "null_not_allowed"
    | "invalid_type"
    | "deferred_value_missing"
    | "deferred_value_invalid";
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
  alternateRoutes?: string[];
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
  fieldAliases?: {
    [k: string]: string;
  };
  hiddenFields?: string[];
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
export interface SchemaSimplificationFixture {
  kind: "schema-simplification";
  description: string;
  input: {
    shape: TypeShape;
    options?: SchemaSimplificationOptions;
  };
  expected: SchemaSimplificationExpectation;
}
export interface TypeShape {
  root: TypeNode;
  types: {
    [k: string]: ObjectType;
  };
}
export interface TypeNode {
  kind: TypeKind;
  scalar?: ScalarKind;
  format?: string;
  items?: TypeNode;
  values?: TypeNode;
  keys?: MapKey;
  enumFacts?: EnumFacts;
  ref?: string;
  schema?: JsonSchemaObject;
  reason?: string;
}
export interface MapKey {
  writable: boolean;
  scalar?: ScalarKind;
  format?: string;
}
export interface EnumFacts {
  wireForm: EnumWireForm;
  combinable?: boolean;
  names: string[];
  numbers: number[];
}
export interface ObjectType {
  name: string;
  description?: string;
  wrapper?: boolean;
  members: Member[];
}
export interface Member {
  name: string;
  type: TypeNode;
  required: boolean;
  readOnly: boolean;
  constructorBound: boolean;
  description?: string;
  constraints?: Constraints;
}
export interface Constraints {
  minSize?: number;
  maxSize?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
}
export interface SchemaSimplificationOptions {
  dropReadOnlyProperties?: boolean;
  maxDepth?: number;
}
export interface SchemaSimplificationExpectation {
  schema: JsonSchemaObject;
  diagnostics?: SchemaDiagnosticCode[];
  defsOrder?: string[];
}
export interface CardFixture {
  kind: "card";
  description: string;
  input: {
    tool: ToolDefinition;
    decision?: "allow" | "deny" | "unknown";
  };
  expected: CardExpectation;
}
export interface CardExpectation {
  name: string;
  description: string;
  parameters: string;
  authUncertain?: boolean;
}
