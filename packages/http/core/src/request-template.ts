import { assertUniqueArgumentNames } from "./argument-names.js";
import type { ArgumentFill } from "./generated/endpoint-descriptor.js";
import { SkMcpTemplateError } from "./errors.js";
import type { Parameter } from "./generated/endpoint-descriptor.js";

export type ParameterLocation = "path" | "query" | "header";

export type ParameterKind = "string" | "integer" | "number" | "boolean";

export type ParameterStyle = NonNullable<Parameter["style"]>;

export type ObjectNotation = NonNullable<Parameter["objectNotation"]>;

/**
 * One member of an object-valued query parameter.
 *
 * `kind` excludes `object`, which is how one level of nesting is a property of
 * the type rather than a rule a reader has to remember.
 */
export interface ObjectMemberBinding {
  readonly name: string;
  readonly kind: ParameterKind;
  readonly isArray?: boolean;
}

interface BindingCommon {
  readonly name: string;
  readonly location: ParameterLocation;
  /**
   * The key the agent sends, when it differs from the wire name. Omitted when
   * they are equal, so two templates describing the same binding stay deeply
   * equal.
   */
  readonly argument?: string;
  /** Present means hidden: the agent cannot send this, the value is written from here. */
  readonly fill?: ArgumentFill;
}

export interface ScalarParameterBinding extends BindingCommon {
  readonly kind: ParameterKind;
  readonly isArray?: boolean;
  /**
   * The delimiter that joins array items into one value; `undefined` repeats
   * the key instead. Normalised from `style`/`explode` by
   * {@link arraySeparatorFor} so the invalid pairings cannot be represented.
   */
  readonly arraySeparator?: string;
}

export interface ObjectParameterBinding extends BindingCommon {
  readonly kind: "object";
  readonly notation: ObjectNotation;
  /**
   * Written in this order. The builder freezes the descriptor's property order
   * here so the composer never reads a schema and the agent's own key order
   * cannot change the composed string.
   */
  readonly members: readonly ObjectMemberBinding[];
}

export type ParameterBinding = ScalarParameterBinding | ObjectParameterBinding;

export type FileSource = "text" | "base64" | "ref";

export type FormFieldBinding =
  | {
      readonly name: string;
      readonly kind: ParameterKind;
      readonly isArray?: boolean;
    }
  | {
      readonly name: string;
      readonly kind: "object";
      readonly members: readonly ObjectMemberBinding[];
    }
  | {
      readonly name: string;
      readonly kind: "file";
      readonly isArray?: boolean;
      /** The descriptor's `contentMediaType`, the last default before `application/octet-stream`. */
      readonly mediaType?: string;
    };

/**
 * The typed fields of a form or multipart body.
 *
 * `fields` is in the order the composer writes them. In field mode the names are the body's wire
 * fields; with a body root they are the members of the root object.
 */
export interface FormBinding {
  readonly notation: ObjectNotation;
  readonly fields: readonly FormFieldBinding[];
}

export const jsonMediaType = "application/json";
export const urlEncodedMediaType = "application/x-www-form-urlencoded";
export const multipartMediaType = "multipart/form-data";
export const textMediaType = "text/plain";

/** `application/json`, `text/json`, and every `+json` structured-syntax suffix type. */
export function isJsonMediaType(mediaType: string): boolean {
  return (
    mediaType === jsonMediaType ||
    mediaType === "text/json" ||
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*\+json$/.test(
      mediaType,
    )
  );
}

export function isFormMediaType(mediaType: string): boolean {
  return mediaType === urlEncodedMediaType || mediaType === multipartMediaType;
}

export const defaultFileSources: ReadonlySet<FileSource> = new Set([
  "text",
  "base64",
]);

type ArrayStyle = Exclude<ParameterStyle, "deepObject">;

const delimiters: Readonly<Record<ArrayStyle, string>> = {
  form: ",",
  spaceDelimited: " ",
  pipeDelimited: "|",
};

/**
 * Normalises an OpenAPI `style`/`explode` pair into a separator.
 *
 * @param explode defaults the way OpenAPI does: `true` for `form`, `false` for every other style.
 * @returns the delimiter to join array items with, or `undefined` to repeat the key.
 * @throws SkMcpTemplateError `unsupported_array_style` for a pairing that has no wire form.
 */
export function arraySeparatorFor(
  style: ParameterStyle | undefined,
  explode: boolean | undefined,
  parameterName: string,
): string | undefined {
  const resolved = style ?? "form";
  if (resolved === "deepObject") {
    throw new SkMcpTemplateError(
      "unsupported_array_style",
      `Parameter '${parameterName}' is an array and declares style 'deepObject', which addresses object members and has no array form.`,
    );
  }
  if (explode ?? resolved === "form") {
    if (resolved !== "form") {
      throw new SkMcpTemplateError(
        "unsupported_array_style",
        `Parameter '${parameterName}' declares style '${resolved}' with explode true, which has no wire form; set explode false.`,
      );
    }
    return undefined;
  }
  return delimiters[resolved];
}

export interface RequestTemplate {
  readonly method: string;
  readonly routeTemplate: string;
  readonly parameters: readonly ParameterBinding[];
  readonly hasBody: boolean;
  /** Wire field names, never agent names. */
  readonly bodyProperties: ReadonlySet<string>;
  readonly bodyAllowsAdditionalProperties: boolean;
  readonly bodyRoot?: string;
  /** Agent key to wire field, for renamed body fields. */
  readonly bodyAliases?: ReadonlyMap<string, string>;
  /** Wire field to fill, for hidden body fields. */
  readonly bodyFills?: ReadonlyMap<string, ArgumentFill>;
  readonly rootFill?: ArgumentFill;
  /**
   * Wire names whose fill must produce a value. Path parameters are always
   * treated as required; this set carries the body fields and body root that
   * the schema declared required.
   */
  readonly requiredFills?: ReadonlySet<string>;
  /** Absent means `application/json`, so a JSON template stays deeply equal to one built before media types existed. */
  readonly contentType?: string;
  /** Present exactly when {@link contentType} is a form or multipart type. */
  readonly form?: FormBinding;
  /** Present exactly when {@link form} declares a file field. */
  readonly fileSources?: ReadonlySet<FileSource>;
}

export interface RequestTemplateInput {
  readonly method: string;
  readonly route: string;
  readonly parameters?: readonly ParameterBinding[];
  readonly bodyProperties?: readonly string[];
  readonly bodyAllowsAdditionalProperties?: boolean;
  readonly bodyRoot?: string;
  readonly bodyAliases?: ReadonlyMap<string, string>;
  readonly bodyFills?: ReadonlyMap<string, ArgumentFill>;
  readonly rootFill?: ArgumentFill;
  readonly requiredFills?: ReadonlySet<string>;
  readonly contentType?: string;
  readonly form?: FormBinding;
  readonly fileSources?: ReadonlySet<FileSource>;
}

function bodyShapeError(message: string): SkMcpTemplateError {
  return new SkMcpTemplateError("unsupported_body_shape", message);
}

function assertFormMembers(
  owner: string,
  members: readonly ObjectMemberBinding[],
): void {
  const seen = new Set<string>();
  for (const member of members) {
    if (structuralMemberName.test(member.name)) {
      throw bodyShapeError(
        `Member '${owner}.${member.name}' carries a name the notation reads as structure; rename it.`,
      );
    }
    if (seen.has(member.name)) {
      throw bodyShapeError(
        `Field '${owner}' declares two members named '${member.name}'.`,
      );
    }
    seen.add(member.name);
  }
}

/**
 * Every rejection a non-JSON body can carry that the binding types cannot already express.
 *
 * A form body is closed and typed: a free-form one has no field list to encode from, and a hidden
 * value in a file or object field would need a second type gate for a shape no fill is declared
 * for. A file in a urlencoded body has no wire form at all.
 */
function assertBodyEncoding(
  input: RequestTemplateInput,
  hasBody: boolean,
): void {
  const contentType = input.contentType ?? jsonMediaType;
  if (!hasBody) {
    if (input.form !== undefined) {
      throw bodyShapeError(
        "A template without a body cannot declare form fields.",
      );
    }
    return;
  }
  if (isJsonMediaType(contentType)) {
    if (input.form !== undefined) {
      throw bodyShapeError(`A ${contentType} body cannot declare form fields.`);
    }
    return;
  }
  if (contentType === textMediaType) {
    if (input.bodyRoot === undefined || input.form !== undefined) {
      throw bodyShapeError(
        "A text/plain body is a single string and takes the body root argument.",
      );
    }
    return;
  }
  if (!isFormMediaType(contentType)) {
    throw bodyShapeError(`No writer exists for a ${contentType} body.`);
  }
  const form = input.form;
  if (form === undefined || form.fields.length === 0) {
    throw bodyShapeError(`A ${contentType} body declares no typed fields.`);
  }
  if (input.bodyAllowsAdditionalProperties === true) {
    throw bodyShapeError(
      `A ${contentType} body cannot be free-form; declare its fields.`,
    );
  }
  const names = new Set<string>();
  for (const field of form.fields) {
    if (names.has(field.name)) {
      throw bodyShapeError(
        `The body declares two fields named '${field.name}'.`,
      );
    }
    names.add(field.name);
    if (field.kind === "object") {
      if (field.members.length === 0) {
        throw bodyShapeError(
          `Field '${field.name}' is an object but declares no members.`,
        );
      }
      assertFormMembers(field.name, field.members);
    }
    if (field.kind === "file" && contentType === urlEncodedMediaType) {
      throw bodyShapeError(
        `Field '${field.name}' is a file, which only a multipart/form-data body can carry.`,
      );
    }
    if (
      (field.kind === "file" || field.kind === "object") &&
      input.bodyFills?.has(field.name) === true
    ) {
      throw bodyShapeError(
        `Field '${field.name}' is a ${field.kind} and cannot be hidden or filled.`,
      );
    }
  }
  if (input.bodyRoot === undefined) {
    const declared = new Set(input.bodyProperties ?? []);
    const matches =
      declared.size === names.size &&
      [...names].every((name) => declared.has(name));
    if (!matches) {
      throw bodyShapeError(
        "The form fields do not name the body's properties.",
      );
    }
  }
  const hasFile = form.fields.some((field) => field.kind === "file");
  if (
    hasFile &&
    input.fileSources !== undefined &&
    input.fileSources.size === 0
  ) {
    throw bodyShapeError("A file field needs at least one file source.");
  }
}

function fitsKind(value: unknown, kind: ParameterKind): boolean {
  switch (kind) {
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return typeof value === "string";
  }
}

/**
 * Constants are gated here rather than at call time.
 *
 * A constant the binding cannot carry would otherwise fail every single call
 * with an error nobody in the request path can act on: the agent did not send
 * it and cannot remove it.
 */
function assertConstantFits(binding: ScalarParameterBinding): void {
  const fill = binding.fill;
  if (fill === undefined || fill.kind !== "constant") {
    return;
  }
  const value = fill.value;
  const ok =
    binding.isArray === true
      ? Array.isArray(value) &&
        value.every((item) => fitsKind(item, binding.kind))
      : fitsKind(value, binding.kind);
  if (!ok) {
    throw new SkMcpTemplateError(
      "invalid_fill_constant",
      `The constant filling '${binding.name}' does not fit a ${binding.isArray === true ? "array of " : ""}${binding.kind} ${binding.location} parameter.`,
    );
  }
}

const structuralMemberName = /[[\].]|^\d+$/;

/**
 * Guard: a member name the notation would re-read as structure is rejected
 * here rather than escaped. `filter[a.b]` and `filter.a.b` are both ambiguous,
 * and `qs` reads `filter[0]` as array index 0 rather than a member named `0`,
 * so such a name does not address the member the host declared.
 */
function assertObjectBinding(binding: ObjectParameterBinding): void {
  if (binding.location !== "query") {
    throw new SkMcpTemplateError(
      "unsupported_object_style",
      `Parameter '${binding.name}' is an object, which only a query parameter can be.`,
    );
  }
  if (binding.fill !== undefined) {
    throw new SkMcpTemplateError(
      "unsupported_object_style",
      `Parameter '${binding.name}' is an object and cannot be hidden or filled.`,
    );
  }
  if (binding.members.length === 0) {
    throw new SkMcpTemplateError(
      "unsupported_object_style",
      `Parameter '${binding.name}' is an object but declares no members.`,
    );
  }
  const seen = new Set<string>();
  for (const member of binding.members) {
    if (structuralMemberName.test(member.name)) {
      throw new SkMcpTemplateError(
        "unsupported_object_nesting",
        `Member '${binding.name}.${member.name}' carries a name the notation reads as structure; rename it.`,
      );
    }
    if (seen.has(member.name)) {
      throw new SkMcpTemplateError(
        "unsupported_object_style",
        `Parameter '${binding.name}' declares two members named '${member.name}'.`,
      );
    }
    seen.add(member.name);
  }
}

/** The agent-facing names a caller may send. */
export function allowedArgumentNames(
  template: RequestTemplate,
): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const parameter of template.parameters) {
    if (parameter.fill === undefined) {
      allowed.add(parameter.argument ?? parameter.name);
    }
  }
  const aliased = new Set(template.bodyAliases?.values() ?? []);
  for (const agentName of template.bodyAliases?.keys() ?? []) {
    allowed.add(agentName);
  }
  for (const field of template.bodyProperties) {
    if (!template.bodyFills?.has(field) && !aliased.has(field)) {
      allowed.add(field);
    }
  }
  if (template.bodyRoot !== undefined && template.rootFill === undefined) {
    allowed.add(template.bodyRoot);
  }
  return allowed;
}

/**
 * Wire names the agent may never send.
 *
 * This set beats the free-form body allowance. Without that precedence an open
 * body accepts a hidden field's wire name and the hide is bypassed; and the
 * wire name of a renamed parameter is accepted, consumed by no loop, and
 * dropped in silence.
 */
export function deniedArgumentNames(
  template: RequestTemplate,
): ReadonlySet<string> {
  const denied = new Set<string>();
  for (const parameter of template.parameters) {
    if (parameter.fill !== undefined || parameter.argument !== undefined) {
      denied.add(parameter.name);
    }
  }
  for (const wireName of template.bodyAliases?.values() ?? []) {
    denied.add(wireName);
  }
  for (const wireName of template.bodyFills?.keys() ?? []) {
    denied.add(wireName);
  }
  if (template.bodyRoot !== undefined && template.rootFill !== undefined) {
    denied.add(template.bodyRoot);
  }
  return denied;
}

const reservedHeaderNames = new Set(["authorization", "cookie"]);
const routePlaceholder = /\{([^}:?*]+)[^}]*\}/g;

/** The placeholder names a route template declares, with constraints and modifiers stripped. */
export function routePlaceholderNames(route: string): Set<string> {
  const names = new Set<string>();
  for (const match of route.matchAll(routePlaceholder)) {
    names.add(match[1] as string);
  }
  return names;
}

export function createRequestTemplate(
  input: RequestTemplateInput,
): RequestTemplate {
  const method = input.method.toUpperCase();
  if (!input.route || input.route.trim().length === 0) {
    throw new SkMcpTemplateError(
      "empty_route",
      "Route template must not be empty.",
    );
  }
  const parameters = input.parameters ?? [];
  const bodyAllowsAdditionalProperties =
    input.bodyAllowsAdditionalProperties ?? false;
  const hasBody =
    input.bodyProperties !== undefined ||
    bodyAllowsAdditionalProperties ||
    input.bodyRoot !== undefined;

  if (
    input.bodyRoot !== undefined &&
    (input.bodyProperties !== undefined || bodyAllowsAdditionalProperties)
  ) {
    throw new SkMcpTemplateError(
      "conflicting_body_modes",
      "A template cannot declare both a body root argument and body properties.",
    );
  }

  if (hasBody && (method === "GET" || method === "HEAD")) {
    throw new SkMcpTemplateError(
      "body_not_allowed",
      `A ${method} request cannot declare a body.`,
    );
  }

  const bodyProperties = assertUniqueArgumentNames(
    parameters.map((parameter) => parameter.name),
    input.bodyRoot === undefined
      ? (input.bodyProperties ?? [])
      : [input.bodyRoot],
  );

  const agentNames = new Set<string>();
  for (const parameter of parameters) {
    if (parameter.fill === undefined) {
      const agentName = parameter.argument ?? parameter.name;
      if (agentNames.has(agentName)) {
        throw new SkMcpTemplateError(
          "argument_collision",
          `Curation produces two arguments named '${agentName}'.`,
        );
      }
      agentNames.add(agentName);
    }
    if (parameter.kind === "object") {
      assertObjectBinding(parameter);
      continue;
    }
    assertConstantFits(parameter);
    if (
      parameter.location === "header" &&
      reservedHeaderNames.has(parameter.name.toLowerCase())
    ) {
      throw new SkMcpTemplateError(
        "identity_carrier_argument",
        `Header parameter '${parameter.name}' collides with an identity carrier; identity is never an argument.`,
      );
    }
    if (parameter.location === "path" && parameter.isArray) {
      throw new SkMcpTemplateError(
        "path_parameter_array",
        `Path parameter '${parameter.name}' cannot be an array.`,
      );
    }
    /**
     * A repeated header is unrepresentable: `ComposedRequest.headers` is a
     * `Record<string, string>`, so the second write would overwrite the first.
     * Folding into one comma-separated value (RFC 9110 §5.3) is the only shape
     * that survives, and it has to be asked for explicitly.
     */
    if (
      parameter.location === "header" &&
      parameter.isArray &&
      parameter.arraySeparator === undefined
    ) {
      throw new SkMcpTemplateError(
        "header_parameter_array",
        `Header parameter '${parameter.name}' is an array but repeats the key, which a header cannot carry; declare explode false.`,
      );
    }
  }

  const normalizedRoute = input.route.replace(
    routePlaceholder,
    (_, name: string) => `{${name}}`,
  );
  const placeholders = routePlaceholderNames(input.route);
  for (const parameter of parameters) {
    if (parameter.location === "path" && !placeholders.has(parameter.name)) {
      throw new SkMcpTemplateError(
        "route_placeholder_mismatch",
        `Path parameter '${parameter.name}' has no '{${parameter.name}}' placeholder in route '${input.route}'.`,
      );
    }
  }
  for (const placeholder of placeholders) {
    if (
      !parameters.some((p) => p.location === "path" && p.name === placeholder)
    ) {
      throw new SkMcpTemplateError(
        "route_placeholder_mismatch",
        `Route placeholder '{${placeholder}}' has no declared path parameter.`,
      );
    }
  }

  for (const agentName of input.bodyAliases?.keys() ?? []) {
    if (agentNames.has(agentName)) {
      throw new SkMcpTemplateError(
        "argument_collision",
        `Curation produces two arguments named '${agentName}'.`,
      );
    }
    agentNames.add(agentName);
  }

  assertBodyEncoding(input, hasBody);
  const contentType =
    hasBody &&
    input.contentType !== undefined &&
    input.contentType !== jsonMediaType
      ? input.contentType
      : undefined;
  const form = contentType === undefined ? undefined : input.form;
  const fileSources = form?.fields.some((field) => field.kind === "file")
    ? (input.fileSources ?? defaultFileSources)
    : undefined;

  return {
    method,
    routeTemplate: normalizedRoute,
    parameters: [...parameters],
    hasBody,
    bodyProperties: input.bodyRoot === undefined ? bodyProperties : new Set(),
    bodyAllowsAdditionalProperties,
    ...(input.bodyRoot === undefined ? {} : { bodyRoot: input.bodyRoot }),
    ...(input.bodyAliases === undefined || input.bodyAliases.size === 0
      ? {}
      : { bodyAliases: input.bodyAliases }),
    ...(input.bodyFills === undefined || input.bodyFills.size === 0
      ? {}
      : { bodyFills: input.bodyFills }),
    ...(input.rootFill === undefined ? {} : { rootFill: input.rootFill }),
    ...(input.requiredFills === undefined || input.requiredFills.size === 0
      ? {}
      : { requiredFills: input.requiredFills }),
    ...(contentType === undefined ? {} : { contentType }),
    ...(form === undefined ? {} : { form }),
    ...(fileSources === undefined ? {} : { fileSources }),
  };
}
