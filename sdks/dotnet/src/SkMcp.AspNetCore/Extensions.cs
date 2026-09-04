using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Server;
using SkMcp.AspNetCore.Caching;
using SkMcp.AspNetCore.Errors;
using SkMcp.AspNetCore.Tools;
using SkMcp.AspNetCore.Transport;
using SkMcp.AspNetCore.Visibility;
using SkMcp.AspNetCore.Visibility.Probe;

namespace SkMcp.AspNetCore;

public static class SkMcpServiceCollectionExtensions
{
    public static IServiceCollection AddSkMcp(
        this IServiceCollection services, Action<SkMcpOptions>? configure = null)
    {
        services.AddOptions<SkMcpOptions>();
        if (configure is not null)
        {
            services.Configure(configure);
        }

        if (services.Any(d => d.ServiceType == typeof(SkMcpRegistrationMarker)))
        {
            return services;
        }
        services.AddSingleton<SkMcpRegistrationMarker>();

        services.TryAddSingleton(TimeProvider.System);
        services.AddHttpContextAccessor();
        services.AddEndpointsApiExplorer();
        services.TryAddSingleton<PipelineHolder>();
        services.TryAddSingleton<SyntheticRequestFactory>();
        services.TryAddSingleton<SkMcpDispatcher>();
        services.TryAddSingleton<SkMcpCatalogProvider>();
        services.TryAddSingleton<ISkMcpCatalogChangeSource>(p => p.GetRequiredService<SkMcpCatalogProvider>());
        services.TryAddSingleton<IVisibilityEvaluator, DeclarativeVisibilityEvaluator>();
        services.TryAddSingleton<IProbeEvaluator, ProbeEvaluator>();
        services.TryAddSingleton<ICallerScopeResolver, CarrierHashCallerScopeResolver>();
        services.TryAddSingleton<ISkMcpCache, MemorySkMcpCache>();
        services.TryAddSingleton<CallerVisibilityProvider>();
        services.TryAddSingleton<ISkMcpCacheInvalidator, SkMcpCacheInvalidator>();
        services.TryAddSingleton<IInvokeResultMapper, InvokeResultMapper>();
        services.TryAddSingleton<IProtectedResourceMetadataProvider, OptionsProtectedResourceMetadataProvider>();
        services.TryAddSingleton<SkMcpEndpointRegistration>();
        services.TryAddSingleton<ToolListChangePublisher>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<SkMcpOptions>, SkMcpOptionsValidator>());
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IPostConfigureOptions<McpServerOptions>, ToolCollectionSetup>());
        services.AddOptions<SkMcpOptions>().ValidateOnStart();

        DecorateAuthorizationResultHandler(services);
        services.Configure<MvcOptions>(mvc => mvc.Filters.Add<ProbeResourceFilter>(int.MinValue));
        services.AddMcpServer().WithHttpTransport().WithTools<SkMcpMetaTools>();
        return services;
    }

    private static void DecorateAuthorizationResultHandler(IServiceCollection services)
    {
        ServiceDescriptor? existing = services.LastOrDefault(d =>
            !d.IsKeyedService && d.ServiceType == typeof(IAuthorizationMiddlewareResultHandler));
        if (existing is not null)
        {
            services.Remove(existing);
        }
        services.AddSingleton<IAuthorizationMiddlewareResultHandler>(provider =>
        {
            IAuthorizationMiddlewareResultHandler inner = existing switch
            {
                { ImplementationInstance: IAuthorizationMiddlewareResultHandler instance } => instance,
                { ImplementationFactory: { } factory } => (IAuthorizationMiddlewareResultHandler)factory(provider),
                { ImplementationType: { } type } =>
                    (IAuthorizationMiddlewareResultHandler)ActivatorUtilities.CreateInstance(provider, type),
                _ => new AuthorizationMiddlewareResultHandler(),
            };
            return new ProbeAuthorizationResultHandler(inner);
        });
    }
}

internal sealed class SkMcpRegistrationMarker;

public static class SkMcpApplicationBuilderExtensions
{
    public static IApplicationBuilder UseSkMcpCapture(this IApplicationBuilder app)
    {
        PipelineHolder holder = app.ApplicationServices.GetRequiredService<PipelineHolder>();
        holder.Registered = true;
        app.UseMiddleware<ResourceServerMiddleware>();
        return app.Use(next =>
        {
            holder.Pipeline = next;
            return next;
        });
    }

    public static IEndpointConventionBuilder MapSkMcp(
        this IEndpointRouteBuilder endpoints, string pattern = "/mcp")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(pattern);

        PipelineHolder holder = endpoints.ServiceProvider.GetRequiredService<PipelineHolder>();
        if (!holder.Registered)
        {
            throw new InvalidOperationException(
                "MapSkMcp() requires app.UseSkMcpCapture() earlier in the pipeline, before UseRouting(), "
                + "UseAuthentication() and UseAuthorization(). Add app.UseSkMcpCapture() near the top of the pipeline.");
        }

        SkMcpCatalogProvider catalog = endpoints.ServiceProvider.GetRequiredService<SkMcpCatalogProvider>();
        catalog.Attach(endpoints.DataSources, pattern);

        SkMcpEndpointRegistration registration = endpoints.ServiceProvider.GetRequiredService<SkMcpEndpointRegistration>();
        registration.Pattern = new PathString(pattern);
        endpoints.ServiceProvider.GetRequiredService<ToolListChangePublisher>();

        endpoints.ServiceProvider.GetService<IHostApplicationLifetime>()
            ?.ApplicationStarted.Register(catalog.WarmUp);

        return endpoints.MapMcp(pattern);
    }
}
