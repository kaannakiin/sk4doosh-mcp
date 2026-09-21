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
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Search;
using SkMcp.AspNetCore.Spec;
using SkMcp.AspNetCore.Tools;

namespace SkMcp.AspNetCore.Discovery;

internal sealed record CatalogDiagnostic(string Code, string Message);

public sealed record CatalogEntry
{
    public required ToolDefinition Tool { get; init; }
    public required EndpointDescriptor Descriptor { get; init; }
    public Endpoint? Endpoint { get; init; }
    public RequestTemplate? Template { get; init; }
    public IReadOnlyList<string>? AlternateRoutes { get; init; }
}

internal sealed record CatalogBuildResult
{
    public required IReadOnlyList<CatalogEntry> Entries { get; init; }
    public required IReadOnlyList<CatalogDiagnostic> Diagnostics { get; init; }
    public required int Discovered { get; init; }
    public required int Selected { get; init; }
    public int Dropped { get; init; }
}

internal static partial class EndpointCatalog
{
    public static CatalogBuildResult Build(
        IApiDescriptionGroupCollectionProvider apiDescriptions,
        EndpointDataSource? endpoints,
        SelectionDefault selectionDefault,
        bool useOperationIds = true,
        string? reservedRoutePrefix = null,
        SchemaMapperOptions? schema = null,
        bool hasFallbackPolicy = false,
        PrefixMode prefixMode = PrefixMode.Always,
        Func<string, string?>? containerPrefix = null,
        Func<string, IReadOnlyList<string>?>? containerTags = null,
        Func<string, CatalogSeverity>? severityOf = null,
        ArgumentCurationOptions? curation = null,
        IReadOnlyList<SelectionRule>? selectionRules = null,
        bool groupQueryObjects = false)
    {
        ArgumentNullException.ThrowIfNull(apiDescriptions);
        severityOf ??= DiagnosticCodes.SeverityOf;
        int dropped = 0;

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
                        selectionDefault, ContainerMarker(action), OperationMarker(action, metadata), target,
                        SelectionResolver.ResolveRules(
                            selectionRules, route, api.HttpMethod ?? string.Empty, target));
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
                        DiagnosticCodes.MissingHttpMethod, $"{route} has no HTTP method constraint."));
                    dropped += 1;
                    continue;
                }

                EndpointDescriptor? descriptor = Describe(
                    api, route, action, metadata, useOperationIds, schema, hasFallbackPolicy,
                    containerPrefix, containerTags, diagnostics,
                    curation ?? new ArgumentCurationOptions(), groupQueryObjects);
                if (descriptor is null)
                {
                    dropped += 1;
                    continue;
                }
                candidates.Add((endpoint, descriptor, OverridesFor(action, metadata)));
            }
        }

        List<CatalogEntry> entries = [];
        Dictionary<string, EndpointDescriptor> claimed = new(StringComparer.Ordinal);

        Dictionary<string, IReadOnlyList<string>> alternates = new(StringComparer.Ordinal);
        List<(Endpoint? Endpoint, EndpointDescriptor Descriptor, ToolAnnotations? Overrides)> operations =
            [.. ToolNameFactory.Deduplicate(candidates, c => c.Descriptor, (kept, folded) =>
            {
                string[] routes = [.. folded.Select(f => f.Descriptor.Route)];
                alternates[FoldKey(kept.Descriptor)] = routes;
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.RouteFolded,
                    $"{kept.Descriptor.Method} {kept.Descriptor.Route} is also mounted at {string.Join(", ", routes)}; "
                    + $"one tool is produced and {kept.Descriptor.Route} is the route it invokes."));
            })];
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
            IReadOnlyList<ToolProduction> productions;
            try
            {
                productions = ToolNameFactory.ExpandProductions([descriptor], d => d);
            }
            catch (SkMcpTemplateException ex)
            {
                diagnostics.Add(new CatalogDiagnostic(ex.Code, ex.Message));
                dropped += 1;
                continue;
            }

            foreach (ToolProduction production in productions)
            {
                ToolVariant? variant = production.Variant;
                string name;
                try
                {
                    name = variant?.Name ?? ToolNameFactory.Create(descriptor, prefixMode);
                    if (prefixMode == PrefixMode.OnCollision
                        && variant is null
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

                CurationRelief? relief = ReliefFor(
                    descriptor, alternates.GetValueOrDefault(FoldKey(descriptor)), diagnostics);
                (RequestTemplate? template, string? failure) = BuildTemplate(
                    descriptor, diagnostics, variant, relief);
                if (failure is not null && severityOf(failure) >= CatalogSeverity.EndpointDropped)
                {
                    dropped += 1;
                    continue;
                }

                ToolDefinition tool = Apply(
                    ToolDefinitionFactory.Create(descriptor, name, variant, relief), overrides);
                if (template is not null)
                {
                    ReportCurationLeaks(
                        tool,
                        template,
                        ResolvedCuration.CuratedDescriptions(descriptor, variant),
                        diagnostics);
                    if (template.BodyAllowsAdditionalProperties && template.BodyFills.Count > 0)
                    {
                        diagnostics.Add(new CatalogDiagnostic(
                            DiagnosticCodes.CuratedOpenBody,
                            $"Tool '{name}' hides an argument on a body that accepts additional properties; "
                            + "the schema cannot express the exclusion, so only the composer enforces it."));
                    }
                }

                entries.Add(new CatalogEntry
                {
                    Tool = tool,
                    Descriptor = descriptor,
                    Endpoint = endpoint,
                    Template = template,
                    AlternateRoutes = alternates.GetValueOrDefault(FoldKey(descriptor)),
                });
            }
        }

        ReportIndistinguishableVariants(entries, diagnostics);

        return new CatalogBuildResult
        {
            Entries = entries,
            Diagnostics = diagnostics,
            Discovered = discovered,
            Selected = selected,
            Dropped = dropped,
        };
    }

    /// <summary>
    /// The schema options a response body is written with.
    /// </summary>
    /// <remarks>
    /// <c>DropReadOnlyProperties</c> is a policy for what the caller may <em>send</em>, so it is
    /// forced off here regardless of the host's setting: a get-only member is a response field
    /// precisely because it is read-only, and dropping it hides the field from the agent. The
    /// two option instances share one <c>Report</c> target, so a DTO bound as both request and
    /// response body would report every shape diagnostic twice; <paramref name="reportedBefore"/>
    /// bounds the scan to this endpoint's own diagnostics so the second pass stays silent without
    /// suppressing an identical message from another endpoint.
    /// </remarks>
    private static SchemaMapperOptions ResponseSchemaOf(
        SchemaMapperOptions request,
        List<CatalogDiagnostic> diagnostics,
        int reportedBefore) => request with
        {
            DropReadOnlyProperties = false,
            Report = diagnostic =>
            {
                for (int i = reportedBefore; i < diagnostics.Count; i += 1)
                {
                    if (diagnostics[i] == diagnostic)
                    {
                        return;
                    }
                }
                diagnostics.Add(diagnostic);
            },
        };

    private static EndpointDescriptor? Describe(
        ApiDescription api,
        string route,
        ActionDescriptor action,
        IReadOnlyList<object> metadata,
        bool useOperationIds,
        SchemaMapperOptions? mapper,
        bool hasFallbackPolicy,
        Func<string, string?>? containerPrefix,
        Func<string, IReadOnlyList<string>?>? containerTags,
        List<CatalogDiagnostic> diagnostics,
        ArgumentCurationOptions curation,
        bool groupQueryObjects)
    {
        List<Parameter> parameters = [];
        RequestBody? body = null;
        int reportedBefore = diagnostics.Count;
        SchemaMapperOptions schema = (mapper ?? new SchemaMapperOptions
        {
            PropertyName = property => property.Name,
        }) with
        {
            Report = diagnostics.Add,
        };
        SchemaMapperOptions responseSchema = ResponseSchemaOf(schema, diagnostics, reportedBefore);

        QueryObjectGrouper.Plan grouped = groupQueryObjects
            ? QueryObjectGrouper.Build(
                api, schema, diagnostics, $"{api.HttpMethod} {route}")
            : QueryObjectGrouper.Empty;

        foreach (ApiParameterDescription parameter in api.ParameterDescriptions)
        {
            if (grouped.Consumed.Contains(parameter))
            {
                continue;
            }
            string? location = Locate(parameter.Source);
            if (location is null)
            {
                if (parameter.Source == BindingSource.Body)
                {
                    if (body is not null)
                    {
                        diagnostics.Add(new CatalogDiagnostic(
                            DiagnosticCodes.MultipleBodyBindings,
                            $"{api.HttpMethod} {route} declares more than one request body; endpoint skipped."));
                        return null;
                    }
                    body = new RequestBody
                    {
                        Schema = JsonSchemaMapper.Map(parameter.Type ?? typeof(object), schema),
                        Required = parameter.IsRequired,
                        Description = ParameterDescription(parameter),
                    };
                }
                else if (parameter.Source == BindingSource.Form
                    || parameter.Source == BindingSource.FormFile)
                {
                    diagnostics.Add(new CatalogDiagnostic(
                        DiagnosticCodes.UnsupportedBinding,
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
                Schema = JsonSchemaMapper.Map(parameter.Type ?? typeof(string), schema),
                Description = ParameterDescription(parameter),
            });
        }
        parameters.AddRange(grouped.Groups);

        if (body is not null
            && RequestBodyShape.BodyRootReasonOf(body, parameters.Select(parameter => parameter.Name)) is { } reason)
        {
            string rootArgument = RequestBodyShape.BodyRootArgument;
            string key = RequestBodyShape.UnflattenableRootKey(body.Schema) ?? "no flattenable member";
            diagnostics.Add(reason switch
            {
                "optional" => new CatalogDiagnostic(
                    DiagnosticCodes.OptionalBodyArgument,
                    $"{api.HttpMethod} {route} binds an optional request body; it is exposed as a single optional '{rootArgument}' argument, so omitting it sends no body at all."),
                "unflattenable_root" => new CatalogDiagnostic(
                    DiagnosticCodes.UnflattenableBodyRoot,
                    $"{api.HttpMethod} {route} binds a request body whose root carries '{key}', which flattening would discard; it is exposed as a single '{rootArgument}' argument that keeps the body schema whole."),
                "collision" => new CatalogDiagnostic(
                    DiagnosticCodes.BodyFieldCollision,
                    $"{api.HttpMethod} {route} binds a request body whose field '{RequestBodyShape.CollidingBodyField(body.Schema, parameters.Select(parameter => parameter.Name))}' collides with a parameter of the same name; it is exposed as a single '{rootArgument}' argument so neither slot is guessed."),
                _ => new CatalogDiagnostic(
                    DiagnosticCodes.SyntheticBodyArgument,
                    $"{api.HttpMethod} {route} binds a request body that is not a JSON object; it is exposed as a single '{rootArgument}' argument whose value becomes the whole body."),
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
                Schema = hasSchema ? JsonSchemaMapper.Map(response.Type!, responseSchema) : null,
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
            Description = SelectionAttribute(action, metadata, operationOnly: true)?.Description
                ?? DescriptionOf(metadata),
            Arguments = CurationReader.Read(
                action, metadata, null, curation,
                api.HttpMethod!.ToUpperInvariant(), route),
            Variants = CurationReader.Variants(
                action, metadata, curation,
                api.HttpMethod!.ToUpperInvariant(), route),
            Parameters = parameters.Count == 0 ? null : parameters,
            RequestBody = body,
            Responses = responses.Count == 0 ? null : responses,
            Auth = ReadAuth(metadata, hasFallbackPolicy),
            Tags = TagsFor(action, metadata, api, containerTags, diagnostics),
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

        Anonymity anonymous = allowAnonymous
            ? Anonymity.Yes
            : hasAuthorizeData || hasFallbackPolicy
                ? Anonymity.No
                : Anonymity.Unknown;
        return new Auth
        {
            Anonymous = anonymous,
            Policies = anonymous == Anonymity.Yes ? [] : policies,
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

    internal static string? ParameterDescription(ApiParameterDescription parameter) =>
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

    private static IReadOnlyList<string>? TagsFor(
        ActionDescriptor action,
        IReadOnlyList<object> metadata,
        ApiDescription api,
        Func<string, IReadOnlyList<string>?>? containerTags,
        List<CatalogDiagnostic> diagnostics)
    {
        string owner = action is ControllerActionDescriptor named
            ? $"{named.ControllerName}.{named.ActionName}"
            : api.RelativePath ?? string.Empty;
        if (DeclaredTags(action, metadata) is { } declared)
        {
            return CleanTags(declared, owner, diagnostics);
        }
        if (containerTags is not null
            && action is ControllerActionDescriptor typed
            && containerTags(typed.ControllerTypeInfo.FullName ?? typed.ControllerName) is { } central)
        {
            return CleanTags(central, owner, diagnostics);
        }
        return action is ControllerActionDescriptor controller
            ? [controller.ControllerName]
            : api.GroupName is null ? null : [api.GroupName];
    }

    private static IReadOnlyList<string>? DeclaredTags(
        ActionDescriptor action, IReadOnlyList<object> metadata)
    {
        if (action is not ControllerActionDescriptor controller)
        {
            return metadata.OfType<McpToolAttribute>().LastOrDefault()?.Tags;
        }
        // Guard: read both levels rather than reusing SelectionAttribute, which returns the method
        // attribute alone whenever one exists. A bare [McpTool] on a method would otherwise erase
        // the container's declared tags, which the NestJS key-by-key merge keeps.
        return controller.MethodInfo.GetCustomAttribute<McpToolAttribute>(inherit: true)?.Tags
            ?? controller.ControllerTypeInfo.GetCustomAttribute<McpToolAttribute>(inherit: true)?.Tags;
    }

    /// <summary>Drops the tags that cannot survive folding, keeping the host's own spelling.</summary>
    /// <remarks>
    /// A tag that folds to nothing can never be matched. Two that fold alike are one filter key but
    /// two index contributions, which doubles that term's search weight for what looks like a
    /// spelling choice.
    /// </remarks>
    private static IReadOnlyList<string> CleanTags(
        IReadOnlyList<string> declared, string owner, List<CatalogDiagnostic> diagnostics)
    {
        Dictionary<string, string> kept = new(StringComparer.Ordinal);
        List<string> order = [];
        foreach (string tag in declared)
        {
            string folded = ToolIndex.FoldToken(tag);
            if (folded.Length == 0)
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.EmptyTag,
                    $"{owner} declares a tag that is empty once folded; no caller can ask for it, so it was dropped."));
                continue;
            }
            if (kept.TryGetValue(folded, out string? first))
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.DuplicateTag,
                    $"{owner} declares '{tag}' and '{first}', which fold to the same tag; the later one was dropped because two equal tags double that term's search weight."));
                continue;
            }
            kept[folded] = tag;
            order.Add(tag);
        }
        return order;
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

    /// <summary>Spares a declaration that only a folded-away route could satisfy.</summary>
    /// <remarks>
    /// Only path parameters can differ between an operation's routes, so the folded routes'
    /// placeholders are the whole vocabulary this has to consider. The same relief is handed to
    /// both consumers, so a name reaches the reporter twice; the set keeps one warning per name.
    /// </remarks>
    private static CurationRelief? ReliefFor(
        EndpointDescriptor descriptor,
        IReadOnlyList<string>? foldedRoutes,
        List<CatalogDiagnostic> diagnostics)
    {
        if (foldedRoutes is null || foldedRoutes.Count == 0)
        {
            return null;
        }
        HashSet<string> foldedNames = new(
            foldedRoutes.SelectMany(route => RoutePlaceholder().Matches(route)
                .Select(match => match.Groups[1].Value)),
            StringComparer.Ordinal);
        foldedNames.ExceptWith(RoutePlaceholder().Matches(descriptor.Route)
            .Select(match => match.Groups[1].Value));
        if (foldedNames.Count == 0)
        {
            return null;
        }

        HashSet<string> reported = new(StringComparer.Ordinal);
        return new CurationRelief(foldedNames, name =>
        {
            if (!reported.Add(name))
            {
                return;
            }
            diagnostics.Add(new CatalogDiagnostic(
                DiagnosticCodes.CurationUnusedOnKeptRoute,
                $"Curation names '{name}', which exists only on a route folded away from "
                + $"{descriptor.Method} {descriptor.Route}; the declaration has no effect on the "
                + "route that is invoked."));
        });
    }

    /// <summary>
    /// Warns when a tool's name or description still names an argument the agent cannot reach.
    /// </summary>
    /// <remarks>
    /// The name is checked as well as the description: a generated name carries
    /// <c>by_&lt;path parameter&gt;</c>, so hiding a path parameter leaves the wire name in the name
    /// itself. The match is heuristic, which is why both codes stay warnings.
    ///
    /// Two codes, because the two haystacks deserve separate severities: the tool's own name and
    /// description, and the descriptions the host wrote in its curation declarations. Descriptions
    /// inherited from the backend's types are deliberately not searched — the host did not write
    /// them while curating, and a generic wire name such as <c>type</c> collides with ordinary
    /// schema prose often enough to drown the signal.
    /// </remarks>
    private static void ReportCurationLeaks(
        ToolDefinition tool, RequestTemplate template, IReadOnlyList<string> descriptions,
        List<CatalogDiagnostic> diagnostics)
    {
        List<string> curated = [
            .. template.Parameters
                .Where(parameter => parameter.Fill is not null || parameter.Argument is not null)
                .Select(parameter => parameter.Name),
            .. template.BodyAliases.Values,
            .. template.BodyFills.Keys,
        ];
        if (curated.Count == 0)
        {
            return;
        }

        IReadOnlyList<string> haystack = ToolIndex.Tokenize($"{tool.Name} {tool.Description}");
        List<IReadOnlyList<string>> curatedProse =
            [.. descriptions.Select(ToolIndex.Tokenize)];
        foreach (string wireName in curated)
        {
            IReadOnlyList<string> needle = ToolIndex.Tokenize(wireName);
            if (needle.Count == 0)
            {
                continue;
            }
            if (ContainsSequence(haystack, needle))
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.CurationLeaksName,
                    $"Tool '{tool.Name}' still names the curated argument '{wireName}' in its name or "
                    + "description; the agent cannot act on it."));
            }
            if (curatedProse.Any(prose => ContainsSequence(prose, needle)))
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.CurationLeaksNameInArgument,
                    $"Tool '{tool.Name}' still names the curated argument '{wireName}' in a curated "
                    + "argument description; the agent can search for it but cannot act on it."));
            }
        }
    }

    private static bool ContainsSequence(IReadOnlyList<string> haystack, IReadOnlyList<string> needle)
    {
        for (int start = 0; start + needle.Count <= haystack.Count; start++)
        {
            bool matched = true;
            for (int offset = 0; offset < needle.Count; offset++)
            {
                if (!string.Equals(haystack[start + offset], needle[offset], StringComparison.Ordinal))
                {
                    matched = false;
                    break;
                }
            }
            if (matched)
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>Warns when two variants of one operation are the same tool twice.</summary>
    /// <remarks>
    /// Equal schemas and equal descriptions mean two cards competing for the same terms on the same
    /// route, which is the search pollution route folding already exists to prevent.
    /// </remarks>
    private static void ReportIndistinguishableVariants(
        IReadOnlyList<CatalogEntry> entries, List<CatalogDiagnostic> diagnostics)
    {
        Dictionary<string, string> seen = new(StringComparer.Ordinal);
        foreach (CatalogEntry entry in entries)
        {
            string key = string.Join(
                '\u0000',
                FoldKey(entry.Descriptor),
                entry.Tool.Description,
                entry.Tool.InputSchema.ToJsonString());
            if (seen.TryGetValue(key, out string? owner))
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.VariantIndistinguishable,
                    $"Tools '{owner}' and '{entry.Tool.Name}' expose the same schema and the same "
                    + "description; make their first clauses differ or the search card cannot tell them apart."));
                continue;
            }
            seen[key] = entry.Tool.Name;
        }
    }

    private static string FoldKey(EndpointDescriptor descriptor) =>
        string.Join('\u0000', descriptor.Container, descriptor.OperationId, descriptor.Method.ToUpperInvariant());

    /// <remarks>
    /// Guard: the nesting rejection has to live here rather than in
    /// <c>RequestTemplate.Create</c>, because <see cref="Kind"/> collapses an unknown member type
    /// to <c>String</c> and the binding type then carries no trace of the object it came from.
    /// The twin is <c>objectBindingFor</c> in packages/core/src/tool.ts.
    /// </remarks>
    private static IReadOnlyList<ObjectMember> MembersOf(Parameter parameter)
    {
        if (parameter.Schema["properties"] is not JsonObject properties)
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedObjectStyle,
                $"Parameter '{parameter.Name}' declares deepObject but carries no object schema.");
        }
        List<ObjectMember> members = [];
        foreach ((string name, JsonNode? node) in properties)
        {
            string? memberType = RequestBodyShape.TypeOf(node?["type"]);
            bool array = memberType == "array";
            string? memberScalar = array
                ? RequestBodyShape.TypeOf(node?["items"]?["type"])
                : memberType;
            if (memberScalar is null or "object" or "array"
                || node?["$ref"] is not null
                || node?["$defs"] is not null)
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.UnsupportedObjectNesting,
                    $"Member '{parameter.Name}.{name}' is not a query scalar or an array of them; flatten it out of the object.");
            }
            members.Add(new ObjectMember(name, Kind(memberScalar), array));
        }
        return members;
    }

    internal static string? Locate(BindingSource? source)
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

    // Guard: empty and whitespace-only segments are dropped so that a trailing slash or a doubled
    // separator cannot reach the route. The TS SDK's normalizeRoute folds them the same way, and a
    // host's selection rule is matched against this string in both SDKs.
    internal static string NormalizeRoute(string? relativePath)
    {
        string route = "/" + string.Join("/", (relativePath ?? string.Empty)
            .Split('/')
            .Select(segment => segment.Trim())
            .Where(segment => segment.Length > 0));
        return RoutePlaceholder().Replace(route, m => "{" + m.Groups[1].Value.TrimStart('*') + "}");
    }

    private static (RequestTemplate? Template, string? FailureCode) BuildTemplate(
        EndpointDescriptor descriptor, List<CatalogDiagnostic> diagnostics,
        ToolVariant? variant = null, CurationRelief? relief = null)
    {
        try
        {
            string[] parameterNames = [.. (descriptor.Parameters ?? []).Select(p => p.Name)];
            string? bodyRoot = descriptor.RequestBody is null
                ? null
                : RequestBodyShape.BodyRootOf(descriptor.RequestBody, parameterNames);
            JsonObject? flattened = descriptor.RequestBody is not null && bodyRoot is null
                ? descriptor.RequestBody.Schema["properties"] as JsonObject
                : null;
            string[] bodyFieldNames = [.. (flattened ?? []).Select(entry => entry.Key)];
            string[] requiredBodyFields = descriptor.RequestBody is not null && bodyRoot is null
                ? [.. (descriptor.RequestBody.Schema["required"] as JsonArray ?? [])
                    .Select(node => node?.GetValue<string>()).OfType<string>()]
                : [];
            ResolvedCuration curation = ResolvedCuration.Resolve(
                descriptor,
                variant,
                CurationShape.Of(
                    parameterNames,
                    (descriptor.Parameters ?? []).Where(p => p.Required).Select(p => p.Name),
                    bodyFieldNames,
                    requiredBodyFields,
                    bodyRoot,
                    descriptor.RequestBody?.Required != false),
                relief);
            HashSet<string> requiredFills = new(StringComparer.Ordinal);

            List<ParameterBinding> bindings = [];
            foreach (Parameter parameter in descriptor.Parameters ?? [])
            {
                string? type = RequestBodyShape.TypeOf(parameter.Schema["type"]);
                bool isArray = type == "array";
                string? scalar = isArray
                    ? RequestBodyShape.TypeOf(parameter.Schema["items"]?["type"])
                    : type;
                ResolvedArgument? resolved = curation.Of(parameter.Name);
                if (resolved?.Fill is not null && parameter.Required)
                {
                    requiredFills.Add(parameter.Name);
                }
                if (type == "object" || parameter.Style == "deepObject")
                {
                    bindings.Add(new ParameterBinding(
                        parameter.Name,
                        Enum.Parse<ParameterLocation>(parameter.In, ignoreCase: true),
                        ParameterKind.String,
                        Argument: resolved?.Argument,
                        Fill: resolved?.Fill,
                        Members: MembersOf(parameter),
                        Notation: RequestTemplate.ObjectNotationFor(
                            parameter.Style, parameter.Explode, parameter.ObjectNotation, parameter.Name)));
                    continue;
                }
                bindings.Add(new ParameterBinding(
                    parameter.Name,
                    Enum.Parse<ParameterLocation>(parameter.In, ignoreCase: true),
                    Kind(scalar),
                    isArray,
                    isArray
                        ? RequestTemplate.ArraySeparatorFor(parameter.Style, parameter.Explode, parameter.Name)
                        : null,
                    resolved?.Argument,
                    resolved?.Fill));
            }

            List<string>? bodyProperties = null;
            bool allowsAdditional = false;
            Dictionary<string, string> bodyAliases = new(StringComparer.Ordinal);
            Dictionary<string, ArgumentFill> bodyFills = new(StringComparer.Ordinal);
            ArgumentFill? rootFill = null;
            if (descriptor.RequestBody is { Schema: { } bodySchema })
            {
                if (bodyRoot is null)
                {
                    if (flattened is not null)
                    {
                        bodyProperties = [.. bodyFieldNames];
                    }
                    allowsAdditional = RequestBodyShape.AllowsAdditional(bodySchema);
                    foreach (string field in bodyFieldNames)
                    {
                        ResolvedArgument? resolved = curation.Of(field);
                        if (resolved?.Argument is { } agentName)
                        {
                            bodyAliases[agentName] = field;
                        }
                        if (resolved?.Fill is { } fill)
                        {
                            bodyFills[field] = fill;
                            if (requiredBodyFields.Contains(field))
                            {
                                requiredFills.Add(field);
                            }
                        }
                    }
                }
                else
                {
                    ResolvedArgument? resolved = curation.Of(bodyRoot);
                    rootFill = resolved?.Fill;
                    if (rootFill is not null && descriptor.RequestBody.Required != false)
                    {
                        requiredFills.Add(bodyRoot);
                    }
                }
            }

            return (RequestTemplate.Create(
                new HttpMethod(descriptor.Method), descriptor.Route, bindings, bodyProperties,
                allowsAdditional, bodyRoot, bodyAliases, bodyFills, rootFill, requiredFills), null);
        }
        catch (Exception ex) when (ex is SkMcpTemplateException or ArgumentException or FormatException)
        {
            string code = ex is SkMcpTemplateException template
                ? template.Code
                : DiagnosticCodes.TemplateRejected;
            diagnostics.Add(new CatalogDiagnostic(
                code, $"{descriptor.Method} {descriptor.Route}: {ex.Message}"));
            return (null, code);
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
