using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
using SkMcp.AspNetCore.Discovery;
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

/// <summary>Raised when a <c>ref</c> was not delivered; the meta-tool layer turns it into an envelope.</summary>
internal sealed class SkMcpFileRefused(string field, string reason, int limit)
    : Exception($"sk-mcp: file argument '{field}' was refused ({reason}).")
{
    public string Field { get; } = field;
    public string Reason { get; } = reason;
    public int Limit { get; } = limit;
}

/// <summary>What an invocation's body needs beyond its arguments: the budgets and whom a <c>ref</c> is resolved for.</summary>
internal sealed record DispatchFiles(InvokeTarget Target, int MaxInlineFileBytes, int MaxFileBytes);

internal sealed class SkMcpDispatcher(
    PipelineHolder holder, SyntheticRequestFactory requests, IServiceProvider services)
{
    private static readonly IReadOnlyDictionary<string, string> NoHeaders =
        new Dictionary<string, string>();

    public Task<DispatchResult> DispatchAsync(
        HttpMethod method, string path, HttpRequest? outerRequest, CancellationToken cancellationToken)
    {
        return DispatchAsync(method, new ComposedRequest(path, NoHeaders, null), outerRequest, cancellationToken, default, null);
    }

    public Task<DispatchResult> DispatchAsync(
        RequestTemplate template, JsonElement arguments, HttpRequest? outerRequest,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, JsonElement>? deferred = null,
        TimeSpan deadline = default,
        DispatchFiles? files = null)
    {
        ComposedRequest composed = RequestComposer.Compose(
            template, arguments, deferred,
            files is null ? null : new ComposeLimits(files.MaxInlineFileBytes));
        return DispatchAsync(template.Method, composed, outerRequest, cancellationToken, deadline, files);
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

    private Func<RefFile, string, ValueTask<ResolvedFile>> RefResolver(
        HttpRequest? outerRequest, DispatchFiles? files, CancellationToken cancellationToken)
    {
        return async (file, field) =>
        {
            Files.ISkMcpFileResolver resolver = services.GetService(typeof(Files.ISkMcpFileResolver))
                as Files.ISkMcpFileResolver
                ?? throw new InvalidOperationException(
                    $"sk-mcp: file argument '{field}' is a ref but no file resolver is registered.");
            if (files is null)
            {
                throw new InvalidOperationException(
                    $"sk-mcp: file argument '{field}' is a ref but the call carries no file budget.");
            }
            int limit = files.MaxFileBytes;
            Files.FileResolution outcome = await resolver.ResolveAsync(
                new Files.FileResolveRequest(
                    file.Ref, field, files.Target, CallerFactory.From(outerRequest?.HttpContext), limit),
                cancellationToken).ConfigureAwait(false);
            switch (outcome)
            {
                case Files.FileResolution.Refused refused:
                    throw new SkMcpFileRefused(field, refused.Reason switch
                    {
                        Files.FileRefusal.NotFound => "not_found",
                        Files.FileRefusal.Forbidden => "forbidden",
                        Files.FileRefusal.TooLarge => "too_large",
                        _ => "unavailable",
                    }, limit);
                case Files.FileResolution.Resolved resolved:
                    if (resolved.Bytes.Length > limit)
                    {
                        throw new SkMcpFileRefused(field, "too_large", limit);
                    }
                    return new ResolvedFile(
                        resolved.Bytes,
                        file.FileName ?? (RequestBodyEncoder.IsUsableFileName(resolved.FileName) ? resolved.FileName! : file.FallbackFileName),
                        file.MediaType ?? (resolved.MediaType is { } type && RequestBodyEncoder.MediaTypeGrammar().IsMatch(type) ? type : file.FallbackMediaType));
                default:
                    throw new InvalidOperationException("sk-mcp: the file resolver returned an unknown resolution.");
            }
        };
    }

    /// <remarks>
    /// Guard: the deadline is armed before any <c>ref</c> is resolved, so a resolver that hangs is
    /// bounded exactly like a backend that hangs. Resolving during the validating composition would
    /// let it outlive the call it serves.
    /// </remarks>
    private async Task<DispatchResult> DispatchAsync(
        HttpMethod method, ComposedRequest composed, HttpRequest? outerRequest,
        CancellationToken cancellationToken, TimeSpan deadline, DispatchFiles? files)
    {
        RequestDelegate pipeline = Pipeline();

        using CancellationTokenSource linked =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (deadline > TimeSpan.Zero)
        {
            linked.CancelAfter(deadline);
        }

        WrittenBody? written = null;
        if (composed.Content is { } content)
        {
            try
            {
                written = await BodyWriter.WriteAsync(content, RefResolver(outerRequest, files, linked.Token))
                    .AsTask().WaitAsync(linked.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (linked.IsCancellationRequested)
            {
                cancellationToken.ThrowIfCancellationRequested();
                throw new SkMcpDispatchTimeout();
            }
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
            if (written is not null)
            {
                context.Request.Body = new MemoryStream(written.Bytes);
                context.Request.ContentLength = written.Bytes.Length;
                context.Request.ContentType = written.ContentType;
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
