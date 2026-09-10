# Why visibility is not enforcement

sk-mcp filters `search_tools` results by the caller's authorization. It is tempting to read that as
a security feature. It is not one, and treating it as one is the most dangerous mistake you can
make with this system.

## Two axes, two responsibilities

|                       | Enforcement (`invoke_tool`)  | Visibility (`search_tools`)                   |
| --------------------- | ---------------------------- | --------------------------------------------- |
| Where it happens      | Your backend's real pipeline | The SDK                                       |
| Checked on every call | Yes, unconditionally         | No — best effort                              |
| Must be correct       | Yes; security lives here     | No; if wrong, invoke still rejects            |
| Purpose               | Security                     | Agent experience, and not leaking what exists |

`invoke_tool` never looks at the visibility filter and never reads the visibility cache. A caller
who guesses a tool name reaches the real pipeline and gets rejected there, by your own
authorization code, exactly as an HTTP client would be.

This is not a gap left open by accident. It is the invariant the whole design rests on.

## Why not just enforce at the filter too

Because then the filter would have to be right, and it cannot be.

Visibility runs at list time, when there is no resource and no arguments. It can only evaluate the
resource-independent gate — scope, claim, role, tenant, license. It cannot evaluate "does alice own
order 7", because there is no order 7 in the question yet.

A filter that is allowed to be wrong is a filter that can be optimistic, and an optimistic filter is
the useful one: it shows you the endpoints you could use for _some_ resource. A filter that had to
be right would have to be pessimistic, and a pessimistic filter would hide every endpoint that
shows callers their own records — which is most of them.

So the design accepts an inexact filter and puts the exact check where it was always going to be:
in the backend, at invoke time, with the arguments in hand.

## Why hidden and nonexistent look the same

When a caller cannot see a tool, `load_tool` answers exactly as it would for a name that does not
exist. There is no "this exists but you may not use it".

The distinction would be an information leak. "There is a tool called `refund_order` but you cannot
use it" tells an attacker your product has refunds, that they are exposed as an endpoint, and
roughly what the endpoint is called. The absence of that sentence costs a legitimate caller
nothing — they could not use it either way.

The same reasoning removes `auth` from `load_tool` output. Policy names are internal vocabulary.
An agent that learns your policy is called `OrdersRead` has learned something about your
authorization model that it has no use for.

## Why uncertainty is carried, not resolved

Some endpoints cannot be decided at list time. The check lives inside the handler, or the backend
has no authentication scheme the SDK can run against a synthetic request.

The obvious move is to pick a side. Both sides are wrong:

- Collapse to `deny`, and an endpoint the caller can genuinely use disappears. You have destroyed a
  capability to avoid admitting you do not know.
- Collapse to `allow`, and you have hidden the uncertainty from the agent, which now believes the
  tool is usable.

So `unknown` is carried all the way to the agent, surfacing as `authUncertain`. The agent is told
the truth: this might work, we could not tell. It is not an unfinished state; it is the honest
answer.

The same principle appears three times in the rule order — an unreported policy is not `allow`, an
unknown identity is not `absent`, an unknown anonymity is not `yes`. sk-mcp does not invent values.

## What this means for you

If your reasoning contains the phrase "it's fine, the agent can't see it", stop. That sentence is
never a security argument in sk-mcp. Enforcement is your backend's job and it always was; sk-mcp
did not take it over, and the filter's job is to make the agent's life easier, not to guard you.
