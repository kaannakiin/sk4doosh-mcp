using System.ComponentModel;
using System.Reflection;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.Authorization;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Routing;
using SkMcp.AspNetCore.Naming;
using SkMcp.AspNetCore.Spec;
using SkMcp.AspNetCore.Tools;

namespace SkMcp.AspNetCore.Discovery;

public sealed record CatalogDiagnostic(string Code, string Message);

public sealed record CatalogEntry
{
    public required ToolDefinition Tool { get; init; }
    public required EndpointDescriptor Descriptor { get; init; }
    public Endpoint? Endpoint { get; init; }
    public RequestTemplate? Template { get; init; }
}

public sealed record CatalogBuildResult
{
    public required IReadOnlyList<CatalogEntry> Entries { get; init; }
    public required IReadOnlyList<CatalogDiagnostic> Diagnostics { get; init; }
    public required int Discovered { get; init; }
    public required int Selected { get; init; }
}

public static partial class EndpointCatalog
{
    public static CatalogBuildResult Build(
        IApiDescriptionGroupCollectionProvider apiDescriptions,
        EndpointDataSource? endpoints,
        SelectionDefault selectionDefault,
        bool useOperationIds = true,
        string? reservedRoutePrefix = null,
        Func<PropertyInfo, string>? propertyName = null,
        bool hasFallbackPolicy = false,
        PrefixMode prefixMode = PrefixMode.Always,
        Func<string, string?>? containerPrefix = null)
    {
        ArgumentNullException.ThrowIfNull(apiDescriptions);

        Dictionary<ActionDescriptor, Endpoint> routed = new();
        foreach (Endpoint endpoint in endpoints?.Endpoints ?? [])
        {
            if (endpoint.Metadata.GetMetadata<ActionDescriptor>() is { } action)
            {
                routed[action] = endpoint;
            }
        }

        List<CatalogDiagnostic> diagnostics = [];
        List<(Endpoint? Endpoint, EndpointDescriptor Descriptor, ToolAnnotations? Overrides)> candidates = [];
        int discovered = 0;
        int selected = 0;

        foreach (ApiDescriptionGroup group in apiDescriptions.ApiDescriptionGroups.Items)
        {
            foreach (ApiDescription api in group.Items)
            {
                discovered += 1;
                string route = NormalizeRoute(api.RelativePath);
                if (reservedRoutePrefix is not null
                    && route.StartsWith(reservedRoutePrefix, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                ActionDescriptor action = api.ActionDescriptor;
                routed.TryGetValue(action, out Endpoint? endpoint);
                IReadOnlyList<object> metadata = endpoint is not null
                    ? [.. endpoint.Metadata]
                    : [.. action.EndpointMetadata ?? []];

                string target = $"{api.HttpMethod} {route}";
                bool include;
                try
                {
                    include = SelectionResolver.IsSelected(
                        selectionDefault, ContainerMarker(action), OperationMarker(action, metadata), target);
                }
                catch (SkMcpCatalogException ex)
                {
                    diagnostics.Add(new CatalogDiagnostic(ex.Code, ex.Message));
                    continue;
                }
                if (!include)
                {
                    continue;
                }
                selected += 1;

                if (string.IsNullOrEmpty(api.HttpMethod))
                {
                    diagnostics.Add(new CatalogDiagnostic(
                        "missing_http_method", $"{route} has no HTTP method constraint."));
                    continue;
                }

                EndpointDescriptor? descriptor = Describe(
                    api, route, action, metadata, useOperationIds, propertyName, hasFallbackPolicy,
                    containerPrefix, diagnostics);
                if (descriptor is not null)
                {
                    candidates.Add((endpoint, descriptor, OverridesFor(action, metadata)));
                }
            }
        }

        List<CatalogEntry> entries = [];
        Dictionary<string, EndpointDescriptor> claimed = new(StringComparer.Ordinal);

        List<(Endpoint? Endpoint, EndpointDescriptor Descriptor, ToolAnnotations? Overrides)> operations =
            [.. ToolNameFactory.Deduplicate(candidates, c => c.Descriptor)];
        Dictionary<string, int> bodyGroups = new(StringComparer.Ordinal);
        if (prefixMode == PrefixMode.OnCollision)
        {
            foreach ((_, EndpointDescriptor descriptor, _) in operations)
            {
                if (descriptor.ToolName is not null)
                {
                    continue;
                }
                string body = ToolNameFactory.CreateBody(descriptor);
                bodyGroups[body] = bodyGroups.TryGetValue(body, out int count) ? count + 1 : 1;
            }
        }

        foreach ((Endpoint? endpoint, EndpointDescriptor descriptor, ToolAnnotations? overrides) in operations)
        {
            string name;
            try
            {
                name = ToolNameFactory.Create(descriptor, prefixMode);
                if (prefixMode == PrefixMode.OnCollision
                    && descriptor.ToolName is null
                    && bodyGroups.TryGetValue(name, out int clashes)
                    && clashes > 1)
                {
                    string prefixed = ToolNameFactory.ApplyPrefix(name, ToolNameFactory.DerivePrefix(descriptor));
                    if (!string.Equals(prefixed, name, StringComparison.Ordinal))
                    {
                        diagnostics.Add(new CatalogDiagnostic(
                            ToolNameFactory.NameDisambiguated,
                            $"Tool name '{name}' collided; {descriptor.Method} {descriptor.Route} is exposed as '{prefixed}'."));
                        name = prefixed;
                    }
                }
            }
            catch (SkMcpCatalogException ex)
            {
                diagnostics.Add(new CatalogDiagnostic(ex.Code, ex.Message));
                continue;
            }
            if (claimed.TryGetValue(name, out EndpointDescriptor? owner))
            {
                diagnostics.Add(new CatalogDiagnostic(
                    SkMcpCatalogException.NameCollision,
                    $"Tool name '{name}' is produced by both {owner.Method} {owner.Route} and {descriptor.Method} {descriptor.Route}."));
                continue;
            }
            claimed[name] = descriptor;

            if (name.Length > ToolNameFactory.LongNameThreshold)
            {
                diagnostics.Add(new CatalogDiagnostic(
                    "long_tool_name",
                    $"Tool name '{name}' is {name.Length} characters; long names cost agent context and weaken search."));
            }

            entries.Add(new CatalogEntry
            {
                Tool = Apply(ToolDefinitionFactory.Create(descriptor), overrides),
                Descriptor = descriptor,
                Endpoint = endpoint,
                Template = BuildTemplate(descriptor, diagnostics),
            });
        }

        return new CatalogBuildResult
        {
            Entries = entries,
            Diagnostics = diagnostics,
            Discovered = discovered,
            Selected = selected,
        };
    }

    private static EndpointDescriptor? Describe(
        ApiDescription api,
        string route,
        ActionDescriptor action,
        IReadOnlyList<object> metadata,
        bool useOperationIds,
        Func<PropertyInfo, string>? propertyName,
        bool hasFallbackPolicy,
        Func<string, string?>? containerPrefix,
        List<CatalogDiagnostic> diagnostics)
    {
        List<Parameter> parameters = [];
        RequestBody? body = null;

        foreach (ApiParameterDescription parameter in api.ParameterDescriptions)
        {
            string? location = Locate(parameter.Source);
            if (location is null)
            {
                if (parameter.Source == BindingSource.Body)
                {
                    body = new RequestBody
                    {
                        Schema = JsonSchemaMapper.Map(parameter.Type ?? typeof(object), propertyName),
                        Description = ParameterDescription(parameter),
                    };
                }
                else if (parameter.Source == BindingSource.Form
                    || parameter.Source == BindingSource.FormFile)
                {
                    diagnostics.Add(new CatalogDiagnostic(
                        "unsupported_binding",
                        $"{api.HttpMethod} {route} binds '{parameter.Name}' from a form; form bodies are out of scope, endpoint skipped."));
                    return null;
                }
                continue;
            }
            parameters.Add(new Parameter
            {
                Name = parameter.Name,
                In = location,
                Required = parameter.IsRequired,
                Schema = JsonSchemaMapper.Map(parameter.Type ?? typeof(string), propertyName),
                Description = ParameterDescription(parameter),
            });
        }

        Dictionary<string, ResponseBody> responses = new(StringComparer.Ordinal);
        foreach (ApiResponseType response in api.SupportedResponseTypes)
        {
            string status = response.StatusCode.ToString();
            if (status.Length != 3 || responses.ContainsKey(status))
            {
                continue;
            }
            bool hasSchema = response.Type is not null && response.Type != typeof(void);
            responses[status] = new ResponseBody
            {
                Schema = hasSchema ? JsonSchemaMapper.Map(response.Type!, propertyName) : null,
            };
        }

        return new EndpointDescriptor
        {
            OperationId = useOperationIds ? OperationId(action, metadata) : null,
            Container = action is ControllerActionDescriptor declaring
                ? declaring.ControllerTypeInfo.FullName
                : null,
            ToolName = SelectionAttribute(action, metadata, operationOnly: true)?.Name,
            ContainerPrefix = PrefixFor(action, metadata, containerPrefix),
            Method = api.HttpMethod!.ToUpperInvariant(),
            Route = route,
            Description = DescriptionOf(metadata),
            Parameters = parameters.Count == 0 ? null : parameters,
            RequestBody = body,
            Responses = responses.Count == 0 ? null : responses,
            Auth = ReadAuth(metadata, hasFallbackPolicy),
            Tags = action is ControllerActionDescriptor controller
                ? [controller.ControllerName]
                : api.GroupName is null ? null : [api.GroupName],
        };
    }

    private static Auth ReadAuth(IReadOnlyList<object> metadata, bool hasFallbackPolicy)
    {
        bool allowAnonymous = false;
        bool hasAuthorizeData = false;
        bool imperative = false;
        List<string> policies = [];

        foreach (object item in metadata)
        {
            switch (item)
            {
                case IAllowAnonymous:
                    allowAnonymous = true;
                    break;
                case IAuthorizeData authorize:
                    hasAuthorizeData = true;
                    if (!string.IsNullOrWhiteSpace(authorize.Policy))
                    {
                        AddPolicy(policies, authorize.Policy);
                    }
                    if (!string.IsNullOrWhiteSpace(authorize.Roles))
                    {
                        string roles = string.Join(',', authorize.Roles
                            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
                        AddPolicy(policies, "roles:" + roles);
                    }
                    break;
                case AuthorizeFilter or AllowAnonymousFilter:
                    break;
                case IAuthorizationFilter or IAsyncAuthorizationFilter:
                    imperative = true;
                    break;
            }
        }

        bool anonymous = allowAnonymous || (!hasAuthorizeData && !hasFallbackPolicy);
        return new Auth
        {
            Anonymous = anonymous,
            Policies = anonymous ? [] : policies,
            Imperative = imperative,
        };
    }

    private static void AddPolicy(List<string> policies, string name)
    {
        if (!policies.Contains(name, StringComparer.Ordinal))
        {
            policies.Add(name);
        }
    }

    private static string? DescriptionOf(IReadOnlyList<object> metadata)
    {
        string? description = null;
        foreach (object item in metadata)
        {
            if (item is IEndpointDescriptionMetadata { Description: { Length: > 0 } declared })
            {
                description = declared;
            }
            else if (item is DescriptionAttribute { Description: { Length: > 0 } attributed })
            {
                description = attributed;
            }
        }
        return description;
    }

    private static string? ParameterDescription(ApiParameterDescription parameter) =>
        parameter.ParameterDescriptor is ControllerParameterDescriptor { ParameterInfo: { } info }
            ? info.GetCustomAttribute<DescriptionAttribute>()?.Description
            : null;

    private static string? OperationId(ActionDescriptor action, IReadOnlyList<object> metadata)
    {
        foreach (object item in metadata)
        {
            if (item is IEndpointNameMetadata { EndpointName: { Length: > 0 } name })
            {
                return name;
            }
        }
        if (!string.IsNullOrWhiteSpace(action.AttributeRouteInfo?.Name))
        {
            return action.AttributeRouteInfo.Name;
        }
        return action is ControllerActionDescriptor controller ? controller.ActionName : null;
    }

    private static McpToolAttribute? SelectionAttribute(
        ActionDescriptor action, IReadOnlyList<object> metadata, bool operationOnly)
    {
        if (action is ControllerActionDescriptor controller)
        {
            McpToolAttribute? operation = controller.MethodInfo
                .GetCustomAttribute<McpToolAttribute>(inherit: true);
            if (operation is not null || operationOnly)
            {
                return operation;
            }
            return controller.ControllerTypeInfo.GetCustomAttribute<McpToolAttribute>(inherit: true);
        }
        return metadata.OfType<McpToolAttribute>().LastOrDefault();
    }

    private static string? PrefixFor(
        ActionDescriptor action, IReadOnlyList<object> metadata, Func<string, string?>? containerPrefix)
    {
        if (SelectionAttribute(action, metadata, operationOnly: false)?.Prefix is { } declared)
        {
            return declared;
        }
        if (containerPrefix is null || action is not ControllerActionDescriptor controller)
        {
            return null;
        }
        return containerPrefix(controller.ControllerTypeInfo.FullName ?? controller.ControllerName);
    }

    private static ToolAnnotations? OverridesFor(ActionDescriptor action, IReadOnlyList<object> metadata)
    {
        if (action is ControllerActionDescriptor controller)
        {
            ToolAnnotations? operation = controller.MethodInfo
                .GetCustomAttribute<McpToolAttribute>(inherit: true)?.Overrides;
            ToolAnnotations? container = controller.ControllerTypeInfo
                .GetCustomAttribute<McpToolAttribute>(inherit: true)?.Overrides;
            return Merge(container, operation);
        }
        return metadata.OfType<McpToolAttribute>().LastOrDefault()?.Overrides;
    }

    private static ToolAnnotations? Merge(ToolAnnotations? general, ToolAnnotations? specific)
    {
        if (general is null || specific is null)
        {
            return specific ?? general;
        }
        return new ToolAnnotations
        {
            ReadOnlyHint = specific.ReadOnlyHint ?? general.ReadOnlyHint,
            DestructiveHint = specific.DestructiveHint ?? general.DestructiveHint,
            IdempotentHint = specific.IdempotentHint ?? general.IdempotentHint,
        };
    }

    private static ToolDefinition Apply(ToolDefinition tool, ToolAnnotations? overrides)
    {
        if (overrides is null)
        {
            return tool;
        }
        return tool with
        {
            Annotations = new ToolAnnotations
            {
                ReadOnlyHint = overrides.ReadOnlyHint ?? tool.Annotations.ReadOnlyHint,
                DestructiveHint = overrides.DestructiveHint ?? tool.Annotations.DestructiveHint,
                IdempotentHint = overrides.IdempotentHint ?? tool.Annotations.IdempotentHint,
            },
        };
    }

    private static SelectionMarker? ContainerMarker(ActionDescriptor action) =>
        action is ControllerActionDescriptor controller
            ? MarkerOf(controller.ControllerTypeInfo.GetCustomAttributes(inherit: true))
            : null;

    private static SelectionMarker? OperationMarker(
        ActionDescriptor action, IReadOnlyList<object> metadata) =>
        action is ControllerActionDescriptor controller
            ? MarkerOf(controller.MethodInfo.GetCustomAttributes(inherit: true))
            : MarkerOf(metadata);

    private static SelectionMarker? MarkerOf(IEnumerable<object> candidates)
    {
        bool include = false;
        bool exclude = false;
        foreach (object candidate in candidates)
        {
            if (candidate is IMcpSelectionMetadata marker)
            {
                if (marker.Include)
                {
                    include = true;
                }
                else
                {
                    exclude = true;
                }
            }
        }
        return SelectionResolver.Combine(include, exclude);
    }

    private static string? Locate(BindingSource? source)
    {
        if (source == BindingSource.Path)
        {
            return "path";
        }
        if (source == BindingSource.Query || source == BindingSource.ModelBinding)
        {
            return "query";
        }
        if (source == BindingSource.Header)
        {
            return "header";
        }
        return null;
    }

    private static string NormalizeRoute(string? relativePath)
    {
        string route = "/" + (relativePath ?? string.Empty).TrimStart('/');
        return RoutePlaceholder().Replace(route, m => "{" + m.Groups[1].Value.TrimStart('*') + "}");
    }

    private static RequestTemplate? BuildTemplate(
        EndpointDescriptor descriptor, List<CatalogDiagnostic> diagnostics)
    {
        try
        {
            List<ParameterBinding> bindings = [];
            foreach (Parameter parameter in descriptor.Parameters ?? [])
            {
                JsonNode? type = parameter.Schema["type"];
                bool isArray = type?.GetValue<string>() == "array";
                JsonNode? scalar = isArray ? parameter.Schema["items"]?["type"] : type;
                bindings.Add(new ParameterBinding(
                    parameter.Name,
                    Enum.Parse<ParameterLocation>(parameter.In, ignoreCase: true),
                    Kind(scalar?.GetValue<string>()),
                    isArray));
            }

            List<string>? bodyProperties = null;
            if (descriptor.RequestBody?.Schema["properties"] is JsonObject properties)
            {
                bodyProperties = [.. properties.Select(p => p.Key)];
            }

            return RequestTemplate.Create(
                new HttpMethod(descriptor.Method), descriptor.Route, bindings, bodyProperties);
        }
        catch (Exception ex) when (ex is SkMcpTemplateException or ArgumentException or FormatException)
        {
            diagnostics.Add(new CatalogDiagnostic(
                "template_rejected", $"{descriptor.Method} {descriptor.Route}: {ex.Message}"));
            return null;
        }
    }

    private static ParameterKind Kind(string? type) => type switch
    {
        "integer" => ParameterKind.Integer,
        "number" => ParameterKind.Number,
        "boolean" => ParameterKind.Boolean,
        _ => ParameterKind.String,
    };

    [GeneratedRegex(@"\{([^}:?=]+)[^}]*\}")]
    private static partial Regex RoutePlaceholder();
}
