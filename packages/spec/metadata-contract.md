# Metadata Contract

> Status: **normative** — validated by two independent implementations (ASP.NET `ToolDefinitionFactory` + TS `createToolDefinition` pass the same `metadata-extraction/` corpus; `EndpointDescriptor` is produced by both frameworks' discovery layers).

Defines two models: the **neutral endpoint model** (`EndpointDescriptor`) that an SDK must extract from its framework, and the **tool definition** (`ToolDefinition`) produced from it. The machine-readable schemas are [schemas/endpoint-descriptor.schema.json](schemas/endpoint-descriptor.schema.json) and [schemas/tool-definition.schema.json](schemas/tool-definition.schema.json) — those are the single source; this document explains them.

## The neutral endpoint model (EndpointDescriptor)

A small, strict subset of OpenAPI. Not a new ontology; a narrowed form of a known vocabulary. The fields:

| Field             | Required | Meaning                                                                                                                                                            |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `operationId`     | no       | The framework's stable operation identity (C#: the action name / `[EndpointName]`; Nest: the method name)                                                          |
| `container`       | no       | The unit hosting the operation (C#: the controller type's full name; Nest: the controller class). The source of the operation identity and of the tool-name prefix |
| `containerPrefix` | no       | A container-prefix declaration; when absent it is derived from the container name ([naming.md](naming.md))                                                         |
| `toolName`        | no       | A full-name declaration; when given, no body is generated and no prefix is applied                                                                                 |
| `method`          | yes      | `GET/HEAD/POST/PUT/PATCH/DELETE`                                                                                                                                   |
| `route`           | yes      | A route template starting with `/`; path parameters in braces                                                                                                      |
| `description`     | no       | A human-written description (C#: XML doc / `[Description]`; Nest: Swagger decorators)                                                                              |
| `parameters`      | no       | `{name, in: path\|query\|header, required, schema, description?}`                                                                                                  |
| `requestBody`     | no       | `{schema, description?}`                                                                                                                                           |
| `responses`       | no       | Status code → `{schema?, description?}`                                                                                                                            |
| `auth`            | yes      | See below                                                                                                                                                          |
| `tags`            | no       | Grouping (C#: the controller name; Nest: the controller / `@ApiTags`)                                                                                              |

Language rule: field names and tool names are in English; `description` contents are free-form (the backend's language).

`containerPrefix` and `toolName` are **declarations** rather than discovered facts: the platform collects them from hierarchical attributes and from the host's global rule, and reduces them to two fields for the pure naming layer. In C#, `[McpTool(Name = ...)]` fills `toolName` at the operation level and `[McpTool(Prefix = ...)]` fills `containerPrefix` at the container (or operation) level; `options.Naming.Prefix` fills the same field when there is no declaration. The order runs from most specific to most general: operation name → operation/container prefix → host rule → derivation from the container.

## Auth representation (v0)

```json
{ "anonymous": false, "policies": ["OrdersRead"], "imperative": false }
```

Three fields, three separate questions. This representation does not define an authorization model; it carries **the readable part** of the backend's own decisions.

- `anonymous` — three-valued: `yes` (the framework's anonymous marker is present), `no` (the framework has an authorization declaration or a fallback policy), `unknown` (no declaration at all; protection may live outside the framework). When it is `yes`, `policies` MUST be empty. It is about **identity** only: an anonymous endpoint may still sit behind another gate such as a license or feature check, and `imperative` carries that. Why `unknown` is not collapsed to `yes` is in the T0 section of [visibility.md](visibility.md).
- `policies` — carries **names** only, never content. The visibility filter hands the names to the backend's own evaluator ([visibility.md](visibility.md)); it does not need to know their content. The combination semantics are AND: the effective set flattened from the framework's hierarchy (global + container + endpoint) is written here. Only **evaluable** names enter it.
- `imperative` — whether the endpoint has authorization logic whose verdict is code. When `true`, declarative evaluation cannot produce a certain `allow` for that endpoint. Imperative logic MUST NOT write a name into `policies`; it only raises this flag — so the question "is this name evaluable" never arises.

`anonymous: false` plus empty `policies` plus `imperative: false` = "identity is enough, no policy" (a bare `[Authorize]`).

`anonymous` is determined by the framework's **real** rule: an endpoint is anonymous if an explicit anonymous marker is present, **or** if there is no declarative authorization data at all and no fallback policy is configured. On an anonymous endpoint `policies` is empty — the anonymous marker short-circuits declarative authorization in the framework too.

Role requirements enter `policies` in the form `roles:<name>[,<name>]` (C#: `[Authorize(Roles = "a, b")]` → `roles:a,b`). Those are declarative and evaluable, and the visibility side recognizes the prefix ([visibility.md](visibility.md)). Filling this form **requires the framework to carry a declarative role contract**; in a framework that does not, `policies` stays empty (see below).

Source mapping: in C#, `policies` comes from the framework's declarative authorization data, and `imperative` from the presence of non-declarative authorization filters or requirements.

In NestJS the situation is asymmetric, and that asymmetry is normative: `@nestjs/common` **defines
no authorization contract at all**. An attached guard is neither "identity required" nor "this is
authorization" — it could equally be a throttler or a tenant resolver. So in Nest the presence of a
guard produces only `imperative: true`, `policies` stays empty, and `anonymous` becomes `unknown`.
There is no framework contract called a "roles decorator" in Nest; the `SetMetadata('roles', …)`
example in Nest's own documentation is a **host convention**, and the SDK MUST NOT read a host type
by name. A Nest host that wants to declare authorization declaratively announces it structurally on
its guard.

The case where both fields stay empty is legitimate and defined: on backends whose auth lives entirely in custom middleware there is nothing to read statically. Such an endpoint becomes `unknown` on the visibility side — missing data MUST NOT be silently converted to `allow` ([visibility.md](visibility.md) rule 4).

## The tool definition (ToolDefinition)

| Field         | Source                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | [naming.md](naming.md)                                                                                                                                                              |
| `description` | `EndpointDescriptor.description`; when absent, the fallback `"{METHOD} {route}"` (for example `"GET /ping"`)                                                                        |
| `inputSchema` | The JSON Schema produced from the parameters plus `requestBody` (`type: object`; each parameter is a property, and the `required` list comes from the parameters' `required` flags) |
| `annotations` | From the table below                                                                                                                                                                |
| `auth`        | `EndpointDescriptor.auth` verbatim. It is an internal model: the visibility filter consumes it and it MUST NOT reach the MCP surface ([visibility.md](visibility.md) invariant 3)   |

## Producing `inputSchema`

- The root is always `type: object` and writes both `properties` and `required` **even when they are empty**. For deterministic comparison: a missing field and an empty field are not the same thing.
- Every parameter is a property, and the property schema is that parameter's `schema`.
- A parameter's `description` is added to the property schema only when **the schema does not carry its own `description`**. The schema source takes precedence; the parameter description is the fallback.
- `requestBody.schema.properties` flatten to the top level; `requestBody.schema.required` entries are appended to the `required` list.
- The `inputSchema` root writes `additionalProperties`, whose value is derived from whether `requestBody.schema` is free-form (see [schema-conversion-rules.md](schema-conversion-rules.md) Table 6). It is not a constant `false`.
- `required` MUST NOT carry duplicate entries and MUST NOT list a name absent from `properties`; a collision between a parameter name and a body field name stops tool production with `argument_collision`.
- `requestBody.description` is deliberately dropped: because body fields flatten to the top level, there is no slot left for it.
- `required` order: parameters first in declaration order, then body properties in declaration order. The order is normative — fixture comparison is sensitive to array order.
- Body property names are the backend's **wire** names, not class member names: the name in the schema is the JSON key the backend actually accepts. The SDK reads this from the framework's serialization settings (C#: the `JsonOptions` naming policy plus `[JsonPropertyName]`); in a setup where it cannot be read (C#: Newtonsoft) it MUST NOT guess — it uses the class member name, emits a `naming_policy_unresolved` diagnostic, and the host declares a resolver.

## Method → annotation table

| Method     | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| ---------- | -------------- | ----------------- | ---------------- |
| GET / HEAD | `true`         | —                 | `true`           |
| POST       | —              | `false`           | —                |
| PUT        | —              | `true`            | `true`           |
| PATCH      | —              | `true`            | —                |
| DELETE     | —              | `true`            | `true`           |

`—` = the field is not written. Rationale: POST is additive (create) and does not overwrite data; PUT is a replacement (destructive but idempotent). Because a static mapping cannot be correct for every endpoint, SDKs SHOULD offer a per-endpoint override (C#: something like `[McpTool(Destructive = true)]`), and an overridden value beats the table.
