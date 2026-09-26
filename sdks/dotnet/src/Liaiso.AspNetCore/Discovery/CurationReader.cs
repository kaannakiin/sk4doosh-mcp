using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Controllers;
using Liaiso.AspNetCore.Spec;

namespace Liaiso.AspNetCore.Discovery;

/// <summary>Reduces attribute and options declarations to the descriptor's pure-data curation.</summary>
/// <remarks>
/// The same reduction the platform already performs for a declared tool name and container prefix:
/// the rule layer reads data, never attributes.
/// </remarks>
internal static class CurationReader
{
    /// <remarks>
    /// The sealed names are collected before the merge, not during it: sealed rules are applied
    /// last so that they win, so a check that learns them as it goes can never see an override.
    /// </remarks>
    public static IReadOnlyList<ArgumentCuration>? Read(
        ActionDescriptor action,
        IReadOnlyList<object> metadata,
        string? variantName,
        ArgumentCurationOptions options,
        string method,
        string route)
    {
        CurationRule[] matching = [.. options.Rules
            .Where(rule => rule.Matches(action, method, route))
            .OrderBy(rule => rule.Specificity)];
        AssertUnambiguous(matching, method, route);

        HashSet<string> sealedNames = new(
            matching.Where(rule => rule.Sealed).SelectMany(rule => rule.Rules.Select(r => r.Name)),
            StringComparer.Ordinal);

        Dictionary<string, ArgumentCuration> merged = new(StringComparer.Ordinal);

        foreach (CurationRule rule in matching.Where(rule => !rule.Sealed))
        {
            Apply(merged, rule.Rules, sealedNames, method, route);
        }
        Apply(merged, FromAttributes(action, metadata, variantName), sealedNames, method, route);
        foreach (CurationRule rule in matching.Where(rule => rule.Sealed))
        {
            Apply(merged, rule.Rules, sealedNames: null, method, route);
        }

        return merged.Count == 0 ? null : [.. merged.Values];
    }

    private static void Apply(
        Dictionary<string, ArgumentCuration> merged,
        IEnumerable<ArgumentCuration> records,
        IReadOnlySet<string>? sealedNames,
        string method,
        string route)
    {
        foreach (ArgumentCuration record in records)
        {
            if (sealedNames?.Contains(record.Name) == true)
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.SealedCurationOverridden,
                    $"Argument '{record.Name}' is sealed on {method} {route}; a sealed rule cannot be overridden.");
            }
            merged[record.Name] = record;
        }
    }

    /// <summary>
    /// Rejects two central rules that set the same argument differently at the same specificity.
    /// </summary>
    /// <remarks>
    /// Between levels the nearer rule simply wins, silently and by design. Within one level there
    /// is no nearer rule, so a merge would have to pick by registration order and the host would be
    /// reading a ladder that does not decide anything.
    /// </remarks>
    private static void AssertUnambiguous(
        IReadOnlyList<CurationRule> rules, string method, string route)
    {
        Dictionary<string, string> claimed = new(StringComparer.Ordinal);
        foreach (CurationRule rule in rules)
        {
            foreach (ArgumentCuration record in rule.Rules)
            {
                string key = string.Join(
                    '\u0000',
                    rule.Specificity.ToString(CultureInfo.InvariantCulture),
                    rule.Sealed ? "sealed" : "open",
                    record.Name);
                string written = JsonSerializer.Serialize(record, LiaisoJson.Wire);
                if (claimed.TryGetValue(key, out string? existing)
                    && !string.Equals(existing, written, StringComparison.Ordinal))
                {
                    throw new LiaisoTemplateException(
                        LiaisoTemplateException.AmbiguousCuration,
                        $"Two curation rules of equal specificity declare argument '{record.Name}' "
                        + $"differently on {method} {route}; narrow one of their targets.");
                }
                claimed[key] = written;
            }
        }
    }

    public static IReadOnlyList<ToolVariant>? Variants(
        ActionDescriptor action,
        IReadOnlyList<object> metadata,
        ArgumentCurationOptions options,
        string method,
        string route)
    {
        if (action is not ControllerActionDescriptor controller)
        {
            return null;
        }
        McpToolVariantAttribute[] declared =
            [.. controller.MethodInfo.GetCustomAttributes<McpToolVariantAttribute>(inherit: true)];
        if (declared.Length == 0)
        {
            return null;
        }
        return [.. declared.Select(variant => new ToolVariant
        {
            Name = variant.Name,
            Description = variant.Description,
            Arguments = Read(action, metadata, variant.Name, options, method, route),
        })];
    }

    private static IEnumerable<ArgumentCuration> FromAttributes(
        ActionDescriptor action, IReadOnlyList<object> metadata, string? variantName)
    {
        List<(string Name, McpArgumentAttribute Attribute)> declared = [];
        if (action is ControllerActionDescriptor controller)
        {
            foreach (McpArgumentAttribute attribute in
                controller.ControllerTypeInfo.GetCustomAttributes<McpArgumentAttribute>(inherit: true))
            {
                AddNamed(declared, attribute);
            }
            foreach (McpArgumentAttribute attribute in
                controller.MethodInfo.GetCustomAttributes<McpArgumentAttribute>(inherit: true))
            {
                AddNamed(declared, attribute);
            }
            foreach (ParameterInfo parameter in controller.MethodInfo.GetParameters())
            {
                foreach (McpArgumentAttribute attribute in
                    parameter.GetCustomAttributes<McpArgumentAttribute>(inherit: true))
                {
                    declared.Add((attribute.Argument ?? parameter.Name ?? string.Empty, attribute));
                }
                foreach ((string name, McpArgumentAttribute attribute) in OnProperties(parameter.ParameterType))
                {
                    declared.Add((name, attribute));
                }
            }
        }
        else
        {
            foreach (McpArgumentAttribute attribute in metadata.OfType<McpArgumentAttribute>())
            {
                AddNamed(declared, attribute);
            }
        }

        foreach ((string name, McpArgumentAttribute attribute) in declared)
        {
            if (name.Length == 0)
            {
                continue;
            }
            if (attribute.Variant is { } restricted
                && !string.Equals(restricted, variantName, StringComparison.Ordinal))
            {
                continue;
            }
            yield return Convert(name, attribute);
        }
    }

    private static void AddNamed(
        List<(string, McpArgumentAttribute)> declared, McpArgumentAttribute attribute)
    {
        if (attribute.Argument is { } name)
        {
            declared.Add((name, attribute));
        }
    }

    private static IEnumerable<(string, McpArgumentAttribute)> OnProperties(Type type)
    {
        if (type.IsPrimitive || type == typeof(string) || type.Namespace?.StartsWith("System", StringComparison.Ordinal) == true)
        {
            yield break;
        }
        foreach (PropertyInfo property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            foreach (McpArgumentAttribute attribute in
                property.GetCustomAttributes<McpArgumentAttribute>(inherit: true))
            {
                yield return (attribute.Argument ?? property.Name, attribute);
            }
        }
    }

    /// <summary>Validates one attribute and reduces it to a declaration.</summary>
    /// <remarks>
    /// A value without <c>Hidden</c> is rejected rather than honoured: a filled but visible
    /// argument is a default, which is a different feature and must not be reachable by accident.
    /// </remarks>
    private static ArgumentCuration Convert(string name, McpArgumentAttribute attribute)
    {
        int values = (attribute.Value is null ? 0 : 1)
            + (attribute.ValueJson is null ? 0 : 1)
            + (attribute.ValueFrom is null ? 0 : 1);
        if (values > 1)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.AmbiguousCuration,
                $"Argument '{name}' declares more than one of Value, ValueJson and ValueFrom.");
        }
        if (values > 0 && !attribute.Hidden)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.AmbiguousCuration,
                $"Argument '{name}' declares a value without Hidden = true; a filled but visible argument is a default, not a curation.");
        }
        return Build(name, attribute);
    }

    private static ArgumentCuration Build(string name, McpArgumentAttribute attribute) => new()
    {
        Name = name,
        As = attribute.Name,
        Description = attribute.Description,
        Hidden = attribute.Hidden ? FillOf(name, attribute) : null,
    };

    private static ArgumentFill FillOf(string name, McpArgumentAttribute attribute)
    {
        if (attribute.ValueFrom is { } source)
        {
            return new ArgumentFill { Kind = ArgumentFillKind.Deferred, Source = source };
        }
        if (attribute.ValueJson is { } json)
        {
            JsonNode? parsed;
            try
            {
                parsed = JsonNode.Parse(json);
            }
            catch (JsonException error)
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.InvalidFillConstant,
                    $"The ValueJson filling '{name}' is not valid JSON: {error.Message}");
            }
            return new ArgumentFill { Kind = ArgumentFillKind.Constant, Value = parsed };
        }
        if (attribute.Value is { } value)
        {
            return new ArgumentFill
            {
                Kind = ArgumentFillKind.Constant,
                Value = JsonSerializer.SerializeToNode(value),
            };
        }
        return new ArgumentFill { Kind = ArgumentFillKind.Omit };
    }
}
