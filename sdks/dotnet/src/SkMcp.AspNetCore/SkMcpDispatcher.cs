using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
using SkMcp.AspNetCore.Errors;
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Visibility.Probe;

namespace SkMcp.AspNetCore;

internal sealed record DispatchResult(int Status, string Body, string? ContentType, IReadOnlyDictionary<string, string> Headers)
{
    public BackendResponse ToBackendResponse() => new(Status, ContentType, Headers, Body);
}

internal sealed record ProbeOutcome(int Status, bool ShortCircuited);

internal sealed class SkMcpDispatcher(PipelineHolder holder, SyntheticRequestFactory requests)
{
    private static readonly IReadOnlyDictionary<string, string> NoHeaders =
        new Dictionary<string, string>();

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

    public async Task<ProbeOutcome> ProbeAsync(
        HttpMethod method, string path, HttpRequest? outerRequest, CancellationToken cancellationToken)
    {
        RequestDelegate pipeline = Pipeline();
        await using SyntheticRequest synthetic = requests.Create(outerRequest, cancellationToken);
        DefaultHttpContext context = synthetic.Context;
        context.Request.Method = method.Method;
        context.Request.Path = path;
        context.Response.Body = Stream.Null;
        SkMcpProbe.MarkProbe(context);

        await pipeline(context);

        return new ProbeOutcome(context.Response.StatusCode, SkMcpProbe.WasShortCircuited(context));
    }

    private RequestDelegate Pipeline() => holder.Pipeline
        ?? throw new InvalidOperationException(
            "sk-mcp pipeline is not captured. Call app.UseSkMcpCapture() before routing and start the host first.");

    private async Task<DispatchResult> DispatchAsync(
        HttpMethod method, ComposedRequest composed, HttpRequest? outerRequest,
        CancellationToken cancellationToken)
    {
        RequestDelegate pipeline = Pipeline();

        await using SyntheticRequest synthetic = requests.Create(outerRequest, cancellationToken);
        DefaultHttpContext context = synthetic.Context;

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

        Dictionary<string, string> headers = new(StringComparer.OrdinalIgnoreCase);
        foreach ((string name, StringValues values) in context.Response.Headers)
        {
            headers[name] = string.Join(", ", values.ToArray());
        }

        return new DispatchResult(context.Response.StatusCode, body, context.Response.ContentType, headers);
    }
}
