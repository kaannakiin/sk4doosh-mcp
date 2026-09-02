using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace SkMcp.AspNetCore;

public sealed class SyntheticRequest(AsyncServiceScope scope, DefaultHttpContext context) : IAsyncDisposable
{
    public DefaultHttpContext Context { get; } = context;

    public ValueTask DisposeAsync() => scope.DisposeAsync();
}

public sealed class SyntheticRequestFactory(
    IServiceScopeFactory scopeFactory,
    IOptions<SkMcpOptions> options)
{
    private static readonly string DefaultUserAgent =
        $"sk-mcp/{typeof(SyntheticRequestFactory).Assembly.GetName().Version?.ToString(3) ?? "0.0.0"}";

    public SyntheticRequest Create(HttpRequest? outerRequest, CancellationToken cancellationToken)
    {
        AsyncServiceScope scope = scopeFactory.CreateAsyncScope();
        DefaultHttpContext context = new()
        {
            RequestServices = scope.ServiceProvider,
            RequestAborted = cancellationToken,
        };

        SyntheticRequestOptions synthetic = options.Value.Synthetic;
        string? outerScheme = outerRequest?.Scheme;
        context.Request.Scheme = synthetic.Scheme
            ?? (string.IsNullOrEmpty(outerScheme) ? "http" : outerScheme);
        context.Request.Host = synthetic.Host is not null
            ? new HostString(synthetic.Host)
            : outerRequest?.Host.HasValue == true ? outerRequest.Host : new HostString("localhost");
        if (!string.IsNullOrEmpty(synthetic.Accept))
        {
            context.Request.Headers.Accept = synthetic.Accept;
        }
        context.Request.Headers.UserAgent = synthetic.UserAgent ?? DefaultUserAgent;
        SkMcpRequest.Mark(context);

        if (outerRequest is not null)
        {
            foreach (string traceHeader in (string[])["traceparent", "tracestate"])
            {
                if (outerRequest.Headers.TryGetValue(traceHeader, out var traceValue))
                {
                    context.Request.Headers[traceHeader] = traceValue;
                }
            }
            if (outerRequest.HttpContext is not null)
            {
                context.TraceIdentifier = outerRequest.HttpContext.TraceIdentifier;
                ConnectionInfo outerConnection = outerRequest.HttpContext.Connection;
                context.Connection.RemoteIpAddress = outerConnection.RemoteIpAddress;
                context.Connection.RemotePort = outerConnection.RemotePort;
                context.Connection.LocalIpAddress = outerConnection.LocalIpAddress;
                context.Connection.LocalPort = outerConnection.LocalPort;
            }

            IdentityForwardingOptions identity = options.Value.Identity;
            foreach (string carrier in identity.Carriers)
            {
                if (outerRequest.Headers.TryGetValue(carrier, out var value))
                {
                    context.Request.Headers[carrier] = value;
                }
            }
            identity.Projector?.Invoke(outerRequest, context.Request);
        }

        return new SyntheticRequest(scope, context);
    }
}
