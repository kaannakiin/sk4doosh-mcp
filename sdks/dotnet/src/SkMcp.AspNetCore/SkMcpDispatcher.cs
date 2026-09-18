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

/// <summary>Raised when an invocation outlived its deadline and was abandoned.</summary>
internal sealed class SkMcpDispatchTimeout()
    : Exception("sk-mcp: the backend did not answer within the invoke deadline.");

internal sealed class SkMcpDispatcher(PipelineHolder holder, SyntheticRequestFactory requests)
{
    private static readonly IReadOnlyDictionary<string, string> NoHeaders =
        new Dictionary<string, string>();

    public Task<DispatchResult> DispatchAsync(
        HttpMethod method, string path, HttpRequest? outerRequest, CancellationToken cancellationToken)
    {
        return DispatchAsync(method, new ComposedRequest(path, NoHeaders, null), outerRequest, cancellationToken, default);
    }

    public Task<DispatchResult> DispatchAsync(
        RequestTemplate template, JsonElement arguments, HttpRequest? outerRequest,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, JsonElement>? deferred = null,
        TimeSpan deadline = default)
    {
        ComposedRequest composed = RequestComposer.Compose(template, arguments, deferred);
        return DispatchAsync(template.Method, composed, outerRequest, cancellationToken, deadline);
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
        CancellationToken cancellationToken, TimeSpan deadline)
    {
        RequestDelegate pipeline = Pipeline();

        using CancellationTokenSource linked =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (deadline > TimeSpan.Zero)
        {
            linked.CancelAfter(deadline);
        }

        SyntheticRequest synthetic = requests.Create(outerRequest, linked.Token);
        bool owned = true;
        try
        {
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

            MemoryStream responseBody = new();
            context.Response.Body = responseBody;

            Task run = pipeline(context);
            TaskCompletionSource abandoned = new(TaskCreationOptions.RunContinuationsAsynchronously);
            using (linked.Token.Register(() => abandoned.TrySetResult()))
            {
                if (await Task.WhenAny(run, abandoned.Task).ConfigureAwait(false) != run)
                {
                    owned = false;
                    Abandon(synthetic, responseBody, run);
                    cancellationToken.ThrowIfCancellationRequested();
                    throw new SkMcpDispatchTimeout();
                }
            }
            await run.ConfigureAwait(false);

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
        finally
        {
            if (owned)
            {
                await synthetic.DisposeAsync().ConfigureAwait(false);
            }
        }
    }

    /// <summary>
    /// Hands the request scope and the response buffer to the handler that is still running, so an
    /// abandoned handler writing after the deadline cannot hit a disposed stream or a disposed DI
    /// scope. Observing <c>task.Exception</c> is what keeps that throw off the finalizer thread as
    /// an unobserved task exception. Pinned by ResponseBudgetTests.
    /// </summary>
    private static void Abandon(SyntheticRequest synthetic, MemoryStream responseBody, Task run)
    {
        _ = run.ContinueWith(
            async completed =>
            {
                _ = completed.Exception;
                await responseBody.DisposeAsync().ConfigureAwait(false);
                await synthetic.DisposeAsync().ConfigureAwait(false);
            },
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }
}
