# Selection Hierarchy

> Status: **normative** — validated by two independent implementations (ASP.NET `SelectionResolver` + TS `isSelected`; `[McpTool]`/`[McpIgnore]` and `@McpTool()`/`@McpIgnore()` pass the same `selection/` corpus).

Defines which endpoints are exposed on the MCP surface. The machine-readable counterpart is the `selection` fixture kind in [schemas/fixture.schema.json](schemas/fixture.schema.json); the corpus is [conformance/selection/](../conformance/selection/).

## Three separate layers, not to be conflated

| Layer           | Its question                                     | Defined in                     |
| --------------- | ------------------------------------------------ | ------------------------------ |
| **Selection**   | Is this endpoint exposed to agents at all?       | this document                  |
| **Visibility**  | Of the exposed ones, which does this caller see? | [visibility.md](visibility.md) |
| **Enforcement** | Does the call go through?                        | the backend's pipeline         |

Selection is caller-independent and fixed at application startup; visibility is computed per caller on every search. An unselected endpoint is invisible to every identity.

## Three levels, most specific wins

| Level       | Scope                                                                            |
| ----------- | -------------------------------------------------------------------------------- |
| `global`    | Every endpoint in the application                                                |
| `container` | Every endpoint in a group (C#: the controller class; Nest: the controller class) |
| `operation` | A single endpoint (C#: the action method; Nest: the handler method)              |

An endpoint's effective decision is the decision of **the most specific level carrying a marker**: `operation` > `container` > `global`. More general levels apply only when no more specific marker exists.

This follows directly from the frameworks' own metadata models; no new mechanism is invented. (The C# counterpart: endpoint metadata arrives ordered from most general to most specific, and the last writer wins. The Nest counterpart: `Reflector`'s resolution, which puts method metadata ahead of class metadata.)

## Markers

Every level is in one of three states: no marker · `include` · `exclude`. The `global` level MUST NOT be marker-less; it always carries a default.

| Input                                      | Result                                          |
| ------------------------------------------ | ----------------------------------------------- |
| `container: include`, `operation: exclude` | out — the most specific wins                    |
| `container: exclude`, `operation: include` | in — the exception exposes that single endpoint |
| `global: include`, no marker               | in                                              |
| `global: exclude`, no marker               | out                                             |

## The global default is `exclude`

Nothing undeclared is exposed. This is the selection form of the default-deny invariant: adding the SDK to a backend MUST NOT mean exposing that backend's entire surface to agents.

`global: include` is a legitimate setup (expose everything, then carve out exceptions), but it **requires a declaration** — it cannot be the default.

## A conflict at the same level is an error

If one level carries both an `include` and an `exclude` marker, that is an error (`ambiguous_selection`). The SDK MUST NOT silently pick one; it fails loudly at startup or build time.

The rule holds even when a more specific level would override that level anyway. The rationale: a contradictory declaration is contradictory source code, and not reporting it would silently change behaviour later, when the more specific marker is removed. Same principle as `name_collision` in [naming.md](naming.md) — silent resolution is forbidden.

## Selection does not determine the name

Selection answers only "is it exposed." The tool name is produced per [naming.md](naming.md), and a name collision is an error independent of selection. Selecting an endpoint does not guarantee its name is valid — both checks run at startup.
