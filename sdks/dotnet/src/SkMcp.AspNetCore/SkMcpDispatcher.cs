using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace SkMcp.AspNetCore;

public sealed record DispatchResult(int Status, string Body);

public sealed class SkMcpDispatcher(
    PipelineHolder holder,
    IServiceScopeFactory scopeFactory,
    IOptions<SkMcpOptions> options)
{
    private static readonly IReadOnlyDictionary<string, string> NoHeaders =
        new Dictionary<string, string>();

    private static readonly string DefaultUserAgent =
        $"sk-mcp/{typeof(SkMcpDispatcher).Assembly.GetName().Version?.ToString(3) ?? "0.0.0"}";

    public Task<DispatchResult> DispatchAsync(
        HttpMethod method, string path, HttpRequest? outerRequest, CancellationToken cancellationToken)
    {
        return DispatchAsync(method, new ComposedRequest(path, NoHeaders, null), outerRequest, cancellationToken);
    }

    public Task<DispatchResult> DispatchAsync(
        RequestTemplate template, JsonElement arguments, HttpRequest? outerRequest,
        CancellationToken cancellationToken)
    {
        ComposedRequest composed = RequestComposer.Compose(template, arguments);
        return DispatchAsync(template.Method, composed, outerRequest, cancellationToken);
    }

    private async Task<DispatchResult> DispatchAsync(
        HttpMethod method, ComposedRequest composed, HttpRequest? outerRequest,
        CancellationToken cancellationToken)
    {
        RequestDelegate pipeline = holder.Pipeline
            ?? throw new InvalidOperationException(
                "sk-mcp pipeline is not captured. Call app.UseSkMcpCapture() before routing and start the host first.");

        await using AsyncServiceScope scope = scopeFactory.CreateAsyncScope();
        DefaultHttpContext context = new()
        {
            RequestServices = scope.ServiceProvider,
            RequestAborted = cancellationToken,
        };
        context.Request.Method = method.Method;
        int queryIndex = composed.PathAndQuery.IndexOf('?');
        if (queryIndex < 0)
        {
            context.Request.Path = composed.PathAndQuery;
        }
        else
        {
            context.Request.Path = composed.PathAndQuery[..queryIndex];
            context.Request.QueryString = new QueryString(composed.PathAndQuery[queryIndex..]);
        }
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

        foreach ((string name, string value) in composed.Headers)
        {
            context.Request.Headers[name] = value;
        }
        if (composed.Body is not null)
        {
            context.Request.Body = new MemoryStream(composed.Body);
            context.Request.ContentLength = composed.Body.Length;
            context.Request.ContentType = "application/json; charset=utf-8";
        }

        using MemoryStream responseBody = new();
        context.Response.Body = responseBody;

        await pipeline(context);

        responseBody.Position = 0;
        using StreamReader reader = new(responseBody);
        string body = await reader.ReadToEndAsync(cancellationToken);
        return new DispatchResult(context.Response.StatusCode, body);
    }
}
