# Visibility decision

Every endpoint gets one of three decisions per caller, per search. This page describes the model.

> **Source of truth.** The normative text is
> [`packages/spec/visibility.md`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/visibility.md);
> where the two differ, the spec wins.

## Decision values

| Value     | Meaning                                                    | Effect on `search_tools`          |
| --------- | ---------------------------------------------------------- | --------------------------------- |
| `allow`   | The caller can use this endpoint for at least one resource | Shown                             |
| `deny`    | The caller cannot use it at all                            | Hidden                            |
| `unknown` | Not evaluable                                              | Shown, with `authUncertain: true` |

`unknown` is a real third value, not a placeholder. Collapsing it to `deny` hides endpoints the
caller can actually use; collapsing it to `allow` hides the uncertainty from the agent.

## Inputs

The decision is a pure function of two records:

- **`auth`** — what the endpoint declares. Its fields are defined by `$defs/Auth` in
  [`endpoint-descriptor.schema.json`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/schemas/endpoint-descriptor.schema.json). That schema is the source of truth; this
  page does not restate the field list.
- **`callerFacts`** — what the platform found out about this caller: a three-valued identity
  (`present` / `absent` / `unknown`) and a set of policy results.

## Rule order

Rules are applied in order. The first match wins.

| #   | Condition                                            | Decision  |
| --- | ---------------------------------------------------- | --------- |
| 1   | Endpoint is not anonymous and identity is `absent`   | `deny`    |
| 2   | Any declared policy evaluated to `deny`              | `deny`    |
| 3   | The endpoint has an imperative check                 | `unknown` |
| 4   | Anonymity is `unknown`                               | `unknown` |
| 5   | Endpoint is not anonymous and identity is `unknown`  | `unknown` |
| 6   | Any declared policy reported no result, or `unknown` | `unknown` |
| 7   | Otherwise                                            | `allow`   |

Rule 1 comes first because absent identity is the cheapest and most certain rejection. Rule 2
precedes rule 3 because policy combination is AND: one certain denial settles the result regardless
of any uncertainty elsewhere.

Rules 3 through 6 all produce `unknown`; their relative order does not change the outcome and is
fixed for readability.

A policy that reported no result is never treated as `allow`. sk-mcp does not invent values —
rule 6 for policies, rule 5 for identity, rule 4 for anonymity are the same principle three times.

## Anonymity is three-valued

`auth.anonymous` describes identity only, not the whole of authorization.

| Endpoint metadata                                                | Value     | Why                                                       |
| ---------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| An anonymous marker is present                                   | `yes`     | Certain: the framework lets this through without identity |
| Declarative authorization data, or a fallback policy, is present | `no`      | Certain: the framework looks for identity                 |
| Neither                                                          | `unknown` | No information                                            |

`yes` alone does not produce `allow`. An anonymous endpoint can still sit behind a license or
feature gate; `yes` only lets the later rules run.

## Evaluation ladder

| Layer | Reads                                                                         | Produces         |
| ----- | ----------------------------------------------------------------------------- | ---------------- |
| T0    | Framework anonymous and authorization markers on the endpoint                 | `auth.anonymous` |
| T1    | The framework's declarative authorization data                                | Policy results   |
| T2    | A synthetic request pushed into the real pipeline, cut off before the handler | `allow` / `deny` |
| T3    | Nothing decided above                                                         | `unknown`        |

## Optimistic semantics

The real authorization function takes a resource. At list time there is no resource — there are no
arguments at all. So visibility answers the optimistic question, "is there _some_ resource this
caller could use this endpoint for", not the pessimistic "could they use it for every resource".

The pessimistic question would hide every endpoint that shows callers their own records, which is
the opposite of what the filter is for.

Concretely: visibility evaluates only the resource-independent gate — everything that runs before
the handler. Resource-dependent refinements are assumed satisfiable and deferred to invoke time.

## Where the decision is used

| Meta-tool      | Consults visibility?                                          |
| -------------- | ------------------------------------------------------------- |
| `search_tools` | Yes                                                           |
| `load_tool`    | Yes — a hidden tool answers exactly as a nonexistent one does |
| `invoke_tool`  | **No**                                                        |

`load_tool` output never contains `auth`. Policy names do not reach the agent.
