using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Liaiso.AspNetCore.Visibility.Probe;

public static class LiaisoProbe
{
    public const int ShortCircuitStatus = StatusCodes.Status204NoContent;

    private const string FlagKey = "liaiso.probe";
    private const string ShortCircuitedKey = "liaiso.probe.short-circuited";

    public static bool IsLiaisoProbe(this HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return context.Items.ContainsKey(FlagKey);
    }

    internal static void MarkProbe(HttpContext context) => context.Items[FlagKey] = true;

    internal static void MarkShortCircuited(HttpContext context) => context.Items[ShortCircuitedKey] = true;

    internal static bool WasShortCircuited(HttpContext context) => context.Items.ContainsKey(ShortCircuitedKey);
}

internal sealed class ProbeAuthorizationResultHandler(IAuthorizationMiddlewareResultHandler inner)
    : IAuthorizationMiddlewareResultHandler
{
    public Task HandleAsync(
        RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        if (!context.IsLiaisoProbe())
        {
            return inner.HandleAsync(next, context, policy, authorizeResult);
        }

        if (!authorizeResult.Succeeded)
        {
            LiaisoProbe.MarkShortCircuited(context);
            return inner.HandleAsync(_ => Task.CompletedTask, context, policy, authorizeResult);
        }
        if (context.GetEndpoint()?.Metadata.GetMetadata<ControllerActionDescriptor>() is not null)
        {
            return next(context);
        }
        LiaisoProbe.MarkShortCircuited(context);
        context.Response.StatusCode = LiaisoProbe.ShortCircuitStatus;
        return Task.CompletedTask;
    }
}

internal sealed class ProbeResourceFilter : IAsyncResourceFilter
{
    public Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        if (!context.HttpContext.IsLiaisoProbe())
        {
            return next();
        }
        LiaisoProbe.MarkShortCircuited(context.HttpContext);
        context.Result = new StatusCodeResult(LiaisoProbe.ShortCircuitStatus);
        return Task.CompletedTask;
    }
}
