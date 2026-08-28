using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

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
        services.AddSingleton<PipelineHolder>();
        services.AddSingleton<SkMcpDispatcher>();
        return services;
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
}
