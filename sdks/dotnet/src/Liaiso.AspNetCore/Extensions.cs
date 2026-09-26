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
using Liaiso.AspNetCore.Caching;
using Liaiso.AspNetCore.Errors;
using Liaiso.AspNetCore.Tools;
using Liaiso.AspNetCore.Transport;
using Liaiso.AspNetCore.Visibility;
using Liaiso.AspNetCore.Visibility.Probe;

namespace Liaiso.AspNetCore;

public static class LiaisoServiceCollectionExtensions
{
    public static IServiceCollection AddLiaiso(
        this IServiceCollection services, Action<LiaisoOptions>? configure = null)
    {
        services.AddOptions<LiaisoOptions>();
        if (configure is not null)
        {
            services.Configure(configure);
        }

        if (services.Any(d => d.ServiceType == typeof(LiaisoRegistrationMarker)))
        {
            return services;
        }
        services.AddSingleton<LiaisoRegistrationMarker>();

        services.TryAddSingleton(TimeProvider.System);
        services.AddHttpContextAccessor();
        services.AddEndpointsApiExplorer();
        services.TryAddSingleton<PipelineHolder>();
        services.TryAddSingleton<SyntheticRequestFactory>();
        services.TryAddSingleton<LiaisoDispatcher>();
        services.TryAddSingleton<LiaisoCatalogProvider>();
        services.TryAddSingleton<ILiaisoCatalogChangeSource>(p => p.GetRequiredService<LiaisoCatalogProvider>());
        services.TryAddSingleton<IVisibilityEvaluator, DeclarativeVisibilityEvaluator>();
        services.TryAddSingleton<IProbeEvaluator, ProbeEvaluator>();
        services.TryAddSingleton<ICallerScopeResolver, CarrierHashCallerScopeResolver>();
        services.TryAddSingleton<ILiaisoCache, MemoryLiaisoCache>();
        services.TryAddSingleton<CallerVisibilityProvider>();
        services.TryAddSingleton<ILiaisoCacheInvalidator, LiaisoCacheInvalidator>();
        services.TryAddSingleton<IInvokeResultMapper, InvokeResultMapper>();
        services.TryAddSingleton<IProtectedResourceMetadataProvider, OptionsProtectedResourceMetadataProvider>();
        services.TryAddSingleton<LiaisoEndpointRegistration>();
        services.TryAddSingleton<ToolListChangePublisher>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<LiaisoOptions>, LiaisoOptionsValidator>());
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IPostConfigureOptions<McpServerOptions>, ToolCollectionSetup>());
        services.AddOptions<LiaisoOptions>().ValidateOnStart();

        DecorateAuthorizationResultHandler(services);
        services.Configure<MvcOptions>(mvc => mvc.Filters.Add<ProbeResourceFilter>(int.MinValue));
        services.AddMcpServer().WithHttpTransport().WithTools<LiaisoMetaTools>();
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

internal sealed class LiaisoRegistrationMarker;

public static class LiaisoApplicationBuilderExtensions
{
    public static IApplicationBuilder UseLiaisoCapture(this IApplicationBuilder app)
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

    public static IEndpointConventionBuilder MapLiaiso(
        this IEndpointRouteBuilder endpoints, string pattern = "/mcp")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(pattern);

        PipelineHolder holder = endpoints.ServiceProvider.GetRequiredService<PipelineHolder>();
        if (!holder.Registered)
        {
            throw new InvalidOperationException(
                "MapLiaiso() requires app.UseLiaisoCapture() earlier in the pipeline, before UseRouting(), "
                + "UseAuthentication() and UseAuthorization(). Add app.UseLiaisoCapture() near the top of the pipeline.");
        }

        LiaisoCatalogProvider catalog = endpoints.ServiceProvider.GetRequiredService<LiaisoCatalogProvider>();
        catalog.Attach(endpoints.DataSources, pattern);

        LiaisoEndpointRegistration registration = endpoints.ServiceProvider.GetRequiredService<LiaisoEndpointRegistration>();
        registration.Pattern = new PathString(pattern);
        endpoints.ServiceProvider.GetRequiredService<ToolListChangePublisher>();

        endpoints.ServiceProvider.GetService<IHostApplicationLifetime>()
            ?.ApplicationStarted.Register(catalog.WarmUp);

        return endpoints.MapMcp(pattern);
    }
}
