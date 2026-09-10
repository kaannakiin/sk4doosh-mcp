# How to declare visibility for a NestJS guard

An sk-mcp catalog filters search results per caller. On NestJS that filtering only works if your
guards tell sk-mcp what they enforce. This page shows how, and what happens when they don't.

## The trap, first

sk-mcp reads each endpoint's guards — global, controller and method — and asks every one of them
for a declaration. A guard declares itself by having a `describeVisibility()` method. **If any
guard on the endpoint lacks that method, the endpoint is marked `imperative: true`, and its
visibility is `unknown` forever.** One undeclared guard is enough; declaring the other three
changes nothing.

That is not a bug. A NestJS guard is arbitrary code — `canActivate` can read a database, call a
service, or check the time — so its _binding_ is readable through `Reflector` but its _meaning_ is
not. sk-mcp refuses to guess.

`unknown` is not a denial. With the default `visibility.onUnknown: "show"` the tool still appears
in search, flagged `authUncertain`, and the caller finds out for real at invoke time.

## Declare a guard

Add `describeVisibility()` returning what the guard enforces:

```ts
@Injectable()
export class OrdersReadGuard implements CanActivate {
  canActivate(): boolean {
    // your real check, unchanged
    return true;
  }

  describeVisibility(): { anonymous: "no"; policies: string[] } {
    return { anonymous: "no", policies: ["OrdersRead"] };
  }
}
```

Two fields, both optional:

- `anonymous` — `"yes"`, `"no"` or `"unknown"`. `"no"` means this guard requires an identity.
- `policies` — the named checks this guard applies. These are compared against what the caller
  satisfies; they never reach the agent.

The method must not throw and must not depend on request state — it is called once at catalog
build time, with no request in scope. sk-mcp swallows a throw and treats the guard as undeclared,
which puts you back in the `unknown` case silently.

Across several guards on one endpoint, `anonymous: "no"` from any guard wins, and `policies` are
unioned.

## When you cannot declare them

Sometimes the guards are not yours to change, or the check genuinely cannot be summarized. Turn on
the probe tier:

```ts
SkMcpModule.forRoot((options) => {
  options.visibility.tier = "probe";
});
```

A probe issues a synthetic request against the endpoint that runs your guards and then
short-circuits before the handler. The verdict comes from what the guards did:

- `401` or `403` → `deny`
- short-circuited with a status below `400` → `allow`
- anything else → `unknown`, and that tool's probe **disables itself** so the cost is paid once

Probing is budgeted, not free: `visibility.probeTopK` (default 25) caps how many candidates are
probed per search and `visibility.probeConcurrency` (default 4) caps parallelism. It is the reason
probe is not the default —
[why probe visibility is not the default](/docs/http-catalog/why-probe-visibility-is-not-the-default)
has the measured cost.

## Give the probe usable path parameters

A probe has to build a URL, and a route like `/orders/{id}` needs an `id`. sk-mcp synthesizes one
from the parameter's type — `1` for an integer, `true` for a boolean, an all-zero UUID, `2000-01-01`
for a date-time, otherwise the literal `probe`.

When that value does not route, the probe returns `unknown` and records why:

```text
the probe path did not route; declare a value in visibility.probeValues
```

Supply one:

```ts
options.visibility.probeValues.set("id", "1");
options.visibility.probeValues.set("tenantslug", "acme");
```

Keys are lowercased parameter names.

## Verify the result

Run a search as two different callers and compare the counts. Against this repository's NestJS
sample, whose four guards are all undeclared:

```bash
SKMCP_BASE_URL=http://127.0.0.1:3000 SKMCP_AUTH=token SKMCP_USER=alice \
  node apps/example-agent-client/dist/main.js --scenario smoke --query "create order"
```

```text
search_tools "create order"  ok    7/8 results
```

Seven of eight, decided by probing — one synthetic request per candidate, on every search. Had the
guards declared themselves, those decisions would come from metadata read once at catalog build
time instead.

## What this cannot do

None of this is enforcement. A caller who guesses a hidden tool's name reaches your guards and is
rejected by them —
[why visibility is not enforcement](/docs/http-catalog/why-visibility-is-not-enforcement).

Nor does declaring a guard change what it does: `describeVisibility()` is read by the catalog and
never consulted by `canActivate`. A wrong declaration makes search results wrong, not your
authorization.
