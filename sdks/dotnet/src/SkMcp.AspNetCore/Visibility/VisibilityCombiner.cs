using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Visibility;

public enum VisibilityDecision { Allow, Deny, Unknown }

public enum CallerIdentity { Present, Absent, Unknown }

public sealed record CallerFacts(
    CallerIdentity Identity,
    IReadOnlyDictionary<string, VisibilityDecision> PolicyResults)
{
    public static readonly CallerFacts UnknownIdentity =
        new(CallerIdentity.Unknown, new Dictionary<string, VisibilityDecision>());
}

internal static class VisibilityCombiner
{
    public static VisibilityDecision Evaluate(Auth auth, CallerFacts caller)
    {
        ArgumentNullException.ThrowIfNull(auth);
        ArgumentNullException.ThrowIfNull(caller);

        if (auth.Anonymous == Anonymity.No && caller.Identity == CallerIdentity.Absent)
        {
            return VisibilityDecision.Deny;
        }
        if (auth.Policies.Any(p => Result(caller, p) == VisibilityDecision.Deny))
        {
            return VisibilityDecision.Deny;
        }
        if (auth.Imperative)
        {
            return VisibilityDecision.Unknown;
        }
        if (auth.Anonymous == Anonymity.Unknown)
        {
            return VisibilityDecision.Unknown;
        }
        if (auth.Anonymous == Anonymity.No && caller.Identity == CallerIdentity.Unknown)
        {
            return VisibilityDecision.Unknown;
        }
        if (auth.Policies.Any(p => Result(caller, p) != VisibilityDecision.Allow))
        {
            return VisibilityDecision.Unknown;
        }
        return VisibilityDecision.Allow;
    }

    private static VisibilityDecision? Result(CallerFacts caller, string policy) =>
        caller.PolicyResults.TryGetValue(policy, out VisibilityDecision decision) ? decision : null;
}
