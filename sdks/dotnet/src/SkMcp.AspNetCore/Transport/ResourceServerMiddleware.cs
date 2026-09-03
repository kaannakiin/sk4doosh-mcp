using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
using ModelContextProtocol;
using ModelContextProtocol.Authentication;

namespace SkMcp.AspNetCore.Transport;

internal sealed class ResourceServerMiddleware(
    RequestDelegate next, SkMcpEndpointRegistration endpoint, IProtectedResourceMetadataProvider metadataProvider)
{
    public async Task InvokeAsync(HttpContext context)
    {
        ProtectedResourceMetadata? metadata = await metadataProvider.GetAsync(context, context.RequestAborted);
        if (metadata is null || endpoint.Pattern is not { } mcpPattern)
        {
            await next(context);
            return;
        }

        if (HttpMethods.IsGet(context.Request.Method)
            && context.Request.Path == ProtectedResourceMetadataPaths.For(mcpPattern))
        {
            context.Response.StatusCode = StatusCodes.Status200OK;
            context.Response.ContentType = "application/json";
            context.Response.Headers.CacheControl = "public, max-age=300";
            await context.Response.WriteAsync(
                JsonSerializer.Serialize(metadata, McpJsonUtilities.DefaultOptions), context.RequestAborted);
            return;
        }

        if (context.Request.Path.StartsWithSegments(mcpPattern))
        {
            Uri challengeUri = ProtectedResourceMetadataPaths.ChallengeUri(metadata);
            context.Response.OnStarting(() =>
            {
                Decorate(context.Response, challengeUri);
                return Task.CompletedTask;
            });
        }

        await next(context);
    }

    private static void Decorate(HttpResponse response, Uri challengeUri)
    {
        if (response.StatusCode != StatusCodes.Status401Unauthorized)
        {
            return;
        }

        StringValues existing = response.Headers.WWWAuthenticate;
        string parameter = $"resource_metadata=\"{challengeUri}\"";

        if (existing.Count == 0)
        {
            response.Headers.WWWAuthenticate = $"Bearer {parameter}";
            return;
        }

        string[] values = existing.ToArray()!;
        for (int i = 0; i < values.Length; i++)
        {
            string value = values[i];
            if (value.Contains("resource_metadata", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }
            if (!value.StartsWith("Bearer", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            string trimmed = value.TrimEnd();
            values[i] = string.Equals(trimmed, "Bearer", StringComparison.OrdinalIgnoreCase)
                ? $"{trimmed} {parameter}"
                : $"{trimmed}, {parameter}";
            response.Headers.WWWAuthenticate = values;
            return;
        }

        response.Headers.WWWAuthenticate = StringValues.Concat(existing, $"Bearer {parameter}");
    }
}
