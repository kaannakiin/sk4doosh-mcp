using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Requests;

internal enum ArgumentSlot { Parameter, Body, BodyRoot }

internal sealed record ResolvedArgument(
    string Name,
    ArgumentSlot Slot,
    bool Required,
    string? Argument,
    string? Description,
    ArgumentFill? Fill);

/// <summary>The shape curation is projected onto, decided before curation runs.</summary>
/// <remarks>
/// Passing it in rather than deriving it here is what keeps curation from influencing shape
/// selection: the body-root decision and the flattening predicate read wire names only.
/// </remarks>
internal sealed record CurationShape(
    IReadOnlyList<string> ParameterNames,
    IReadOnlyList<string> BodyFieldNames,
    string? BodyRoot,
    IReadOnlySet<string> RequiredWireNames)
{
    public static CurationShape Of(
        IReadOnlyList<string> parameterNames,
        IEnumerable<string> requiredParameterNames,
        IReadOnlyList<string> bodyFieldNames,
        IEnumerable<string> requiredBodyFieldNames,
        string? bodyRoot,
        bool bodyRootRequired)
    {
        HashSet<string> required = new(requiredParameterNames, StringComparer.Ordinal);
        if (bodyRoot is null)
        {
            required.UnionWith(requiredBodyFieldNames);
        }
        else if (bodyRootRequired)
        {
            required.Add(bodyRoot);
        }
        return new CurationShape(
            parameterNames,
            bodyRoot is null ? bodyFieldNames : [],
            bodyRoot,
            required);
    }
}

/// <summary>Spares a declaration that only a route folded away from this one could satisfy.</summary>
/// <remarks>
/// Folding keeps the shortest route, and two routes of one operation can carry different path
/// parameters. Without this, which route wins a length comparison decides whether the endpoint
/// builds at all. Fail-closed still holds: the argument genuinely does not exist on the route that
/// will be invoked, so the declaration is dropped rather than applied.
/// </remarks>
internal sealed record CurationRelief(IReadOnlySet<string> FoldedNames, Action<string> OnUnused);

internal sealed class ResolvedCuration
{
    public static readonly ResolvedCuration Empty =
        new(new Dictionary<string, ResolvedArgument>(StringComparer.Ordinal));

    private ResolvedCuration(IReadOnlyDictionary<string, ResolvedArgument> byWireName)
    {
        ByWireName = byWireName;
    }

    public IReadOnlyDictionary<string, ResolvedArgument> ByWireName { get; }

    public ResolvedArgument? Of(string wireName) =>
        ByWireName.TryGetValue(wireName, out ResolvedArgument? resolved) ? resolved : null;

    /// <summary>Merges the endpoint's declarations with a variant's.</summary>
    /// <remarks>
    /// The merge is whole-record replacement per wire name, never field by field: a field-level
    /// merge means a host who omits <c>tenantId</c> from one variant leaks it, which is a
    /// security-shaped silent failure. A record carrying only a name therefore resets that argument
    /// to the endpoint's own shape.
    /// </remarks>
    public static ResolvedCuration Resolve(
        EndpointDescriptor endpoint, ToolVariant? variant, CurationShape shape,
        CurationRelief? relief = null)
    {
        Dictionary<string, ArgumentCuration> merged = new(StringComparer.Ordinal);
        foreach (ArgumentCuration record in endpoint.Arguments ?? [])
        {
            if (!merged.TryAdd(record.Name, record))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.DuplicateArgument,
                    $"Argument '{record.Name}' is curated twice.");
            }
        }
        HashSet<string> seenInVariant = new(StringComparer.Ordinal);
        foreach (ArgumentCuration record in variant?.Arguments ?? [])
        {
            if (!seenInVariant.Add(record.Name))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.DuplicateArgument,
                    $"Argument '{record.Name}' is curated twice by variant '{variant?.Name}'.");
            }
            merged[record.Name] = record;
        }
        if (merged.Count == 0)
        {
            return Empty;
        }

        Dictionary<string, ResolvedArgument> resolved = new(StringComparer.Ordinal);
        foreach (ArgumentCuration record in merged.Values)
        {
            if (SlotOf(record.Name, shape) is not { } slot)
            {
                if (relief?.FoldedNames.Contains(record.Name) == true)
                {
                    relief.OnUnused(record.Name);
                    continue;
                }
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.CurationUnresolved,
                    $"Curation names '{record.Name}', which this operation does not have. Argument names are matched exactly, including case.");
            }
            bool required = shape.RequiredWireNames.Contains(record.Name);
            if (record.Hidden?.Kind == ArgumentFillKind.Omit && required)
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.HiddenRequiredOmitted,
                    $"Argument '{record.Name}' is required, so it cannot be hidden without a value.");
            }
            resolved[record.Name] = new ResolvedArgument(
                record.Name,
                slot,
                required,
                string.Equals(record.As, record.Name, StringComparison.Ordinal) ? null : record.As,
                record.Description,
                record.Hidden);
        }

        AssertAgentNamesUnique(resolved, shape);
        return new ResolvedCuration(resolved);
    }

    private static ArgumentSlot? SlotOf(string name, CurationShape shape)
    {
        if (shape.ParameterNames.Contains(name, StringComparer.Ordinal))
        {
            return ArgumentSlot.Parameter;
        }
        if (shape.BodyRoot is not null)
        {
            return string.Equals(shape.BodyRoot, name, StringComparison.Ordinal)
                ? ArgumentSlot.BodyRoot
                : null;
        }
        return shape.BodyFieldNames.Contains(name, StringComparer.Ordinal)
            ? ArgumentSlot.Body
            : null;
    }

    /// <summary>
    /// The visible agent namespace has to stay unique, and the check cannot be the wire-name one:
    /// a rename can collide with a name that is itself renamed away, in which case the allowed and
    /// denied sets would overlap and the deny-list would become unstateable.
    /// </summary>
    private static void AssertAgentNamesUnique(
        IReadOnlyDictionary<string, ResolvedArgument> resolved, CurationShape shape)
    {
        IEnumerable<string> wireNames = shape.BodyRoot is null
            ? shape.ParameterNames.Concat(shape.BodyFieldNames)
            : shape.ParameterNames.Concat([shape.BodyRoot]);
        HashSet<string> seen = new(StringComparer.Ordinal);
        foreach (string wireName in wireNames)
        {
            resolved.TryGetValue(wireName, out ResolvedArgument? record);
            if (record?.Fill is not null)
            {
                continue;
            }
            string agentName = record?.Argument ?? wireName;
            if (!seen.Add(agentName))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.ArgumentCollision,
                    $"Curation produces two arguments named '{agentName}'.");
            }
        }
    }
}
