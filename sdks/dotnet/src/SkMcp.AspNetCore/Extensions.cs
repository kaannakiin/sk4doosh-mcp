using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using SkMcp.AspNetCore.Tools;
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
        services.AddHttpContextAccessor();
        services.AddEndpointsApiExplorer();
        services.AddSingleton<PipelineHolder>();
        services.AddSingleton<SyntheticRequestFactory>();
        services.AddSingleton<SkMcpDispatcher>();
        services.AddSingleton<SkMcpCatalogProvider>();
        services.AddSingleton<IVisibilityEvaluator, DeclarativeVisibilityEvaluator>();
        services.AddSingleton<IProbeEvaluator, ProbeEvaluator>();
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

public static class SkMcpApplicationBuilderExtensions
{
    public static IApplicationBuilder UseSkMcpCapture(this IApplicationBuilder app)
    {
        PipelineHolder holder = app.ApplicationServices.GetRequiredService<PipelineHolder>();
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

        SkMcpCatalogProvider catalog = endpoints.ServiceProvider.GetRequiredService<SkMcpCatalogProvider>();
        catalog.Attach(endpoints.DataSources, pattern);

        endpoints.ServiceProvider.GetService<IHostApplicationLifetime>()
            ?.ApplicationStarted.Register(catalog.WarmUp);

        return endpoints.MapMcp(pattern);
    }
}
