using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Caching;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Errors;
using SkMcp.AspNetCore.Spec;
using SkMcp.AspNetCore.Tools;
using SkMcp.AspNetCore.Visibility;

namespace SkMcp.Tests;

public sealed class ResponseBudgetTests
{
    private const int Budget = 4_096;

    private sealed record BudgetHarness(WebApplication App, SkMcpMetaTools Tools, SkMcpOptions Options) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            await App.StopAsync();
            await App.DisposeAsync();
        }
    }

    private static async Task<BudgetHarness> HostAsync(Action<SkMcpOptions>? configure = null)
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp(o =>
        {
            o.Invoke.MaxResponseBytes = Budget;
            o.Invoke.Timeout = TimeSpan.FromMilliseconds(150);
            configure?.Invoke(o);
        });

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.MapGet("/rows", (int limit) =>
                Enumerable.Range(0, limit).Select(index => new { id = index, note = new string('x', 64) }))
            .WithMetadata(new McpToolAttribute { Name = "list_rows" });
        app.MapGet("/exact", (int pad) => new { pad = new string('y', pad) })
            .WithMetadata(new McpToolAttribute { Name = "exact_size" });
        app.MapGet("/slow", async (CancellationToken token) =>
            {
                await Task.Delay(TimeSpan.FromSeconds(5), token);
                return new { eventually = true };
            })
            .WithMetadata(new McpToolAttribute { Name = "slow_call" });
        app.MapGet("/stubborn", async () =>
            {
                await Task.Delay(TimeSpan.FromMilliseconds(400), CancellationToken.None);
                return new { ignored = true };
            })
            .WithMetadata(new McpToolAttribute { Name = "stubborn_call" });
        app.MapSkMcp("/mcp");
        await app.StartAsync();

        SkMcpMetaTools tools = new(
            app.Services.GetRequiredService<SkMcpCatalogProvider>(),
            app.Services.GetRequiredService<SkMcpDispatcher>(),
            app.Services.GetRequiredService<IInvokeResultMapper>(),
            app.Services.GetRequiredService<CallerVisibilityProvider>(),
            app.Services.GetRequiredService<ICallerScopeResolver>(),
            app.Services.GetRequiredService<IOptions<SkMcpOptions>>(),
            new FixedContext(new DefaultHttpContext()),
            app.Services.GetRequiredService<ILogger<SkMcpMetaTools>>());
        return new BudgetHarness(app, tools, app.Services.GetRequiredService<IOptions<SkMcpOptions>>().Value);
    }

    private static async Task<(SdkError? Error, JsonElement Raw, bool IsError)> InvokeAsync(
        SkMcpMetaTools tools, string name, object arguments)
    {
        CallToolResult result = await tools.InvokeTool(
            name, JsonSerializer.SerializeToElement(arguments), CancellationToken.None);
        string text = ((TextContentBlock)result.Content[0]).Text;
        JsonElement raw = JsonDocument.Parse(text).RootElement.Clone();
        SdkError? error = raw.TryGetProperty("error", out _) && !raw.TryGetProperty("status", out _)
            ? JsonSerializer.Deserialize<SdkError>(text, SkMcpJson.Wire)
            : null;
        return (error, raw, result.IsError == true);
    }

    [Fact]
    public async Task R1_OversizeResponse_IsRefusedAndNamesNarrowingArguments()
    {
        await using BudgetHarness harness = await HostAsync();
        (SdkError? error, _, bool isError) = await InvokeAsync(harness.Tools, "list_rows", new { limit = 200 });

        Assert.True(isError);
        Assert.NotNull(error);
        Assert.Equal(SdkErrorCode.ResponseTooLarge, error!.Error);
        Assert.False(error.Retryable);
        Assert.Equal(Budget, error.Payload!.Limit);
        Assert.True(error.Payload.Bytes > Budget);
        Assert.Equal(PayloadShapeKind.Array, error.Payload.Shape.Kind);
        Assert.Equal(200, error.Payload.Shape.Count);
        Assert.Contains(error.Fields!, field => field.Name == "limit");
        Assert.DoesNotContain("xxxx", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task R2_ResponseThatFits_IsAdmitted()
    {
        await using BudgetHarness harness = await HostAsync();

        (_, _, bool fitsIsError) = await InvokeAsync(harness.Tools, "exact_size", new { pad = 1_000 });
        Assert.False(fitsIsError);

        (SdkError? over, _, bool overIsError) = await InvokeAsync(harness.Tools, "exact_size", new { pad = 8_000 });
        Assert.True(overIsError);
        Assert.Equal(SdkErrorCode.ResponseTooLarge, over!.Error);
    }

    [Fact]
    public async Task R3_PerEndpointOverride_LowersTheBudgetForOneToolAlone()
    {
        await using BudgetHarness harness = await HostAsync(o =>
            o.Invoke.MaxResponseBytesFor = target => target.Tool == "exact_size" ? 32 : null);

        (SdkError? overridden, _, bool overriddenIsError) =
            await InvokeAsync(harness.Tools, "exact_size", new { pad = 100 });
        Assert.True(overriddenIsError);
        Assert.Equal(32, overridden!.Payload!.Limit);

        (_, _, bool untouchedIsError) = await InvokeAsync(harness.Tools, "list_rows", new { limit = 2 });
        Assert.False(untouchedIsError);
    }

    [Fact]
    public async Task R4_DeadlineExpiry_AnswersWithInvokeTimeout()
    {
        await using BudgetHarness harness = await HostAsync();
        (SdkError? error, _, bool isError) = await InvokeAsync(harness.Tools, "slow_call", new { });

        Assert.True(isError);
        Assert.Equal(SdkErrorCode.InvokeTimeout, error!.Error);
        Assert.True(error.Retryable);
        Assert.Contains("150 ms", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task R5_AbandonedHandler_LeavesNoUnobservedTaskException()
    {
        List<Exception> unobserved = [];
        void OnUnobserved(object? sender, UnobservedTaskExceptionEventArgs args)
        {
            unobserved.Add(args.Exception);
            args.SetObserved();
        }

        TaskScheduler.UnobservedTaskException += OnUnobserved;
        try
        {
            await using (BudgetHarness harness = await HostAsync())
            {
                (SdkError? error, _, _) = await InvokeAsync(harness.Tools, "stubborn_call", new { });
                Assert.Equal(SdkErrorCode.InvokeTimeout, error!.Error);
                await Task.Delay(TimeSpan.FromMilliseconds(600));
            }

            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            Assert.Empty(unobserved);
        }
        finally
        {
            TaskScheduler.UnobservedTaskException -= OnUnobserved;
        }
    }
}
