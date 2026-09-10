# Visibility

> Status: **normative** — validated by two independent implementations (ASP.NET `VisibilityCombiner` + TS `evaluateVisibility` pass the same `visibility/` corpus; T0/T1/T2 implemented in both frameworks, with platform differences named explicitly in the text).

Defines how `search_tools` results are filtered against the caller's authorization. The machine-readable counterpart is the `visibility` fixture kind in [schemas/fixture.schema.json](schemas/fixture.schema.json); the corpus is [conformance/visibility/](../conformance/visibility/).

## Two axes, two different responsibilities

|                        | Enforcement (`invoke_tool`) | Visibility (`search_tools`)        |
| ---------------------- | --------------------------- | ---------------------------------- |
| Where it happens       | The backend's real pipeline | The SDK                            |
| Verified on every call | **Yes, unconditionally**    | No — best-effort                   |
| Must it be correct     | Required; security is here  | No; if wrong, invoke still rejects |
| Purpose                | Security                    | UX + preventing existence leaks    |

## The decision is three-valued

`allow` (show) · `deny` (hide) · `unknown` (could not be evaluated).

Forcing `unknown` into two values is wrong in both directions: collapsing it to `deny` makes an endpoint the caller genuinely can use invisible (it destroys capability), and collapsing it to `allow` hides the uncertainty from the agent. The third value is carried through and surfaces on the card as `authUncertain`.

## Optimistic semantics

The real authorization function is `auth(endpoint, caller, resource, env)`. At list time there is no `resource` — there are no arguments at all. Two different questions can be asked:

- **Optimistic:** is there _some_ resource this caller could use this endpoint for?
- **Pessimistic:** could they use it for every resource?

Visibility answers the **optimistic** question. The pessimistic question would hide every endpoint that shows callers their own records, which is the opposite of what the filter is for.

The optimistic question is answerable under one condition: that authorization factors into a **resource-independent gate** (scope, claim, role, tenant, license) and a **resource-dependent refinement** (row level, ownership). Real systems are built this way: the gate on the endpoint, the refinement inside the handler.

> **Normative:** Visibility evaluates only authorization's resource-independent gate. Resource-dependent refinements are assumed _satisfiable_; that decision is deferred to invoke time.

The mechanical counterpart maps one-to-one: the resource-independent gate is everything that runs before the handler.

## A pure core

Evaluation splits in two. That split is the precondition for being fixture-able.

**The platform side (impure, SDK-specific)** answers two questions — "does the caller have an identity?" and "is policy P satisfied?" — and writes the answers into `CallerFacts`.

- Identity is resolved by running the backend's own authentication over a synthetic request built with the **same** composition invoke uses (ASP.NET: `IAuthenticationService.AuthenticateAsync`; NestJS: running the guard in a synthetic context). The result is three-valued: `present` (identity resolved), `absent` (no identity, or an invalid one), `unknown` (the backend has no authentication that can be asked this way — identity lives in custom middleware). The SDK MUST NOT collapse `unknown` to `absent`: if it did, every tool requiring identity would be hidden on a backend with no authentication scheme.
- Policy answers are only requested while identity is `present`; with no identity, or an unknown one, no policy result is reported.

**The pure side (specified, language-independent):** `(auth, callerFacts) → decision`. Rules are applied **in order**, and the first match wins:

1. `auth.anonymous` is `no` and `callerFacts.identity` is `absent` → `deny`
2. any name in `auth.policies` resolves to `deny` → `deny`
3. `auth.imperative` is true → `unknown`
4. `auth.anonymous` is `unknown` → `unknown`
5. `auth.anonymous` is `no` and `callerFacts.identity` is `unknown` → `unknown`
6. any name in `auth.policies` has no reported result, or resolves to `unknown` → `unknown`
7. otherwise → `allow`

Why that order:

- **1 comes first:** an absent identity is the cheapest and most certain rejection.
- **2 before 3:** policy combination is AND, so one certain denial settles the result regardless of any uncertainty elsewhere. The reverse order would drop an endpoint we know something certain about into uncertainty.
- **3, 4, 5 and 6** all produce `unknown`; their relative order does not change the outcome and is fixed for readability.
- **A policy with no reported result is not treated as `allow`** (rule 6). The SDK MUST NOT invent values — this is the visibility form of the "no invention" invariant. The same principle is rule 5 for identity and rule 4 for anonymity.

`auth.anonymous` is about **identity** only, not about the whole of authorization: an anonymous endpoint can still sit behind an imperative check such as a license or feature gate. That is why `yes` alone does not produce `allow`; it only lets the later rules run.

## The evaluation ladder

The tiers are defined over framework contracts; the SDK MUST NOT recognize any host-specific type.

| Tier           | What it reads                                                                                      | What it produces                |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| T0 anonymous   | The framework's anonymous/authorization markers in endpoint metadata                               | `auth.anonymous` (three-valued) |
| T1 declarative | The framework's declarative authorization data → combined policy → evaluable requirements          | `policyResults` entries         |
| T2 probe       | A synthetic request enters the real pipeline and is cut **before the handler**; the status is read | `allow` / `deny`                |
| T3             | Nothing above decided                                                                              | `unknown`                       |

T0 reads three-valued, because what the metadata says and what the backend does are not the same thing:

| Endpoint metadata                                                           | `auth.anonymous` | Why                                                                                      |
| --------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| An anonymous marker is present (`IAllowAnonymous`)                          | `yes`            | Certain knowledge: the framework lets this endpoint through without looking for identity |
| Declarative authorization data is present, or the app has a fallback policy | `no`             | Certain knowledge: the framework looks for identity                                      |
| Neither                                                                     | `unknown`        | **No knowledge**                                                                         |

That third row was the rule this spec got wrong most easily. An earlier version treated it as `yes`, justified by the framework's own behaviour: in ASP.NET, an endpoint with no `[Authorize]` and no fallback is never evaluated by the authorization middleware. That is true but **narrow**: it speaks only about the framework's authorization layer, and it does not say "nothing stops this endpoint."

Protection may well live outside the framework. Middleware **does not write** to endpoint metadata, it only reads it: `app.UseMiddleware<...>()` attaches to the pipeline, not to an endpoint, so there is no marker saying "this middleware protects me." On a backend that establishes identity in a global middleware, metadata carries only negative markers (anonymous exemptions) and never a positive one. Measured: on a real 718-endpoint backend, all 698 tools came out `yes`; 447 of them fell to `unknown` anyway because they carried an imperative marker, but the remaining 251 appeared as `allow`, entered an unauthenticated caller's list, and returned 401 at invoke time.

`unknown` represents that ignorance honestly and hands the decision to the probe: the synthetic request enters the real pipeline, the custom middleware's 401 is observed **with no cut marker set**, and is read as `deny`. In other words, protection that cannot be read is measured by running it. A backend that declares authorization declaratively pays nothing: as long as `[Authorize]` and `[AllowAnonymous]` are written, the answer is static.

The deliberate limit **varies by platform**: endpoints with no probe cut point stay `unknown` and are shown with `authUncertain`. On ASP.NET Core those are minimal APIs and route handlers that declare no authorization; there a single `[AllowAnonymous]` settles the answer — one line written in the framework, not in the SDK. On NestJS that class of endpoint **does not exist**: every discovered endpoint is a controller route, and the SDK's cut layer is installed for all of them, so every endpoint can be probed.

Roles are declarative and evaluable: a framework's role requirement is written into `auth.policies` as a name of the form `roles:<name>[,<name>]`, and T1 recognizes that prefix and builds a role policy. This only works on platforms where **the framework carries a declarative role contract**; on a platform that does not (NestJS), `policies` stays empty and the decision is handed to T2 ([metadata-contract.md](metadata-contract.md)).

Blind evaluation at T1 is forbidden: running a requirement that needs a resource without one can produce a false `deny`. Only the resource-independent requirement kinds the framework itself recognizes are evaluated; the rest is `unknown`.

T2 is opt-in and its cost is bounded: the probe is applied to the first K candidates **after ranking**, so cost grows with K rather than with the number of endpoints. A probe cannot have side effects — the cut point is before the handler, and no probe is issued unless the cut layer is proven to be installed for that endpoint.

## T2 probe: mechanics

For an endpoint the declarative tier left as `unknown`, the probe obtains the framework's real verdict: a synthetic request (with the same identity composition as invoke) enters the real pipeline and is cut immediately after the authorization decision, **before** the handler.

- **The cost policy belongs to the host.** How aggressively the probe should run varies by backend: database load, rate limiters and acceptable search latency differ in every deployment. The SDK offers two settings with reasonable defaults: candidate count (`ProbeTopK`, the first K after ranking) and concurrency (`ProbeConcurrency`, 1 = sequential). T2 verdicts are additionally cached per caller; key derivation, namespacing, lifetime/jitter and invalidation are now normative in a separate document, [caching.md](caching.md). If `Identity.Project` derives a value from something other than the outer request (a clock, a counter, a database), the correct lever — as [caching.md](caching.md) also notes — is to override `ICallerScopeResolver`, not to disable the cache.
- **The flag lives in the request context, not in a header** (C#: `HttpContext.Items`). An outer request MUST NOT be able to turn probe mode on. The host MAY use the flag to skip audit, rate-limit and logging middleware (C#: `IsSkMcpProbe()`). For skips that are not probe-specific, the synthetic-request marker is used instead (C#: `IsSkMcpRequest()`, M9) — that marker is also carried at invoke time.
- **Two cut points:** the framework's authorization-middleware result handler, and an MVC resource filter (after every authorization filter, before model binding). The result handler records a **rejection** for every endpoint; on **success** it cuts only endpoints with no MVC action (minimal APIs) — for an MVC action it continues to `next` so imperative authorization filters run and the resource filter reads the verdict. Otherwise an endpoint carrying `[Authorize]` plus an imperative filter would be counted as `allow` without the filter ever running. A cut probe returns a success status plus the cut marker. If the host has its own result handler it is wrapped, never replaced.
- **Eligibility (framework-neutral):** the endpoint MUST be known to routing **and** the SDK's cut layer MUST be **proven** installed for that endpoint — that is, the endpoint's execution must pass through a stage where the SDK registered a cut point, running after all authorization and before the handler. Without that proof a probe is issued only if the endpoint carries declarative authorization data **and** its method is safe (GET/HEAD).

  **Guarantee:** the handler of an unsafe method **never runs under any circumstances**. In the unproven branch, a safe method's handler MAY run **at most once** per endpoint: the moment an unmarked response is observed, the probe is permanently disabled for that endpoint (see "Verdict" below). That second sentence is not a relaxation but an honest statement of the guarantee both implementations actually provide — an endpoint _declaring_ authorization does not prove the cut layer is _installed_ in the pipeline.

  | Platform     | Cut layer proven                                    | Is the fallback branch used                              |
  | ------------ | --------------------------------------------------- | -------------------------------------------------------- |
  | ASP.NET Core | MVC actions (global resource filter)                | Yes — a minimal API carrying `[Authorize]` plus GET/HEAD |
  | NestJS       | **every catalog entry** (all are controller routes) | No                                                       |

- **Verdict:** `401`/`403` → `deny`, with or without the cut marker: if a middleware rejected before the authorization layer, the handler did not run (this is the path for backends whose auth lives in custom middleware). Cut marker plus success → `allow`. Every other response — an unmarked 2xx in particular — → `unknown`; the probe is permanently disabled for that endpoint and a warning is logged, because the handler may have run and MUST NOT be tried a second time. An unmarked `404` means the route did not match: the host declares the placeholder value.
- **Budget:** only after ranking, only for those left as `unknown`, and only the first K candidates (default 25). Anything outside the budget is handled by the `unknown` policy. `total` is the declarative count; the probe does not change it.
- **Request shape:** path parameters are filled with a placeholder derived from the route constraint (numeric → `1`, guid → the empty guid, bool → `true`, date → `2000-01-01`, otherwise → `probe`); the host MAY declare a value by parameter name. Query and body are not sent — the cut is before model binding, so no formatter runs.

## `load_tool` is subject to visibility

Filtering search results while handing the schema to everyone makes hiding meaningless: the agent guesses the name and `load_tool` confirms existence. So `load_tool` applies the same decision — for a `deny` tool its answer is **identical** to the answer for a nonexistent tool (`unknown_tool`). An `unknown` tool is returned and carries `authUncertain`. Per invariant 1, `invoke_tool` stays untouched: calling a hidden tool is the pipeline's business.

## The `unknown` policy

Default: **show** plus `authUncertain`. Rationale: preserve capability, and rely on enforcement being guaranteed at invoke time. Deployments sensitive to existence leaks MAY switch to `Hide` — the policy belongs to whoever writes the code.

## Invariants

1. **Invoke MUST NEVER consult the visibility filter.** If it did there would be two sources of truth, and they would diverge over time. Even if the agent guesses a hidden tool's name and calls it, the pipeline stops it.
2. **Visibility MUST use exactly the same identity composition as invoke** (the same carrier list, the same projector). If they diverge, the filter and enforcement contradict each other, and that is the most confusing class of error a user encounters.
3. **Policy names MUST NOT leak to the agent.** `auth` is an internal model; only `authUncertain` reaches the MCP surface.
4. **Hiding MUST NOT report a reason.** A filtered endpoint is removed from the result; saying "you are not authorized" discloses its existence.
5. Visibility **is not a security mechanism.** This document does not define an authorization model; it reads the backend's own decisions.
