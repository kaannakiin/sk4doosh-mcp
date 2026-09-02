using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace SkMcp.AspNetCore.Visibility;

public interface IVisibilityEvaluator
{
    Task<CallerFacts> ResolveAsync(
        HttpRequest? outerRequest, IReadOnlySet<string> policyNames, CancellationToken cancellationToken);
}

public sealed class DeclarativeVisibilityEvaluator(SyntheticRequestFactory requests) : IVisibilityEvaluator
{
    public const string RolesPrefix = "roles:";

    private static readonly HashSet<Type> Evaluable =
    [
        typeof(DenyAnonymousAuthorizationRequirement),
        typeof(ClaimsAuthorizationRequirement),
        typeof(RolesAuthorizationRequirement),
        typeof(NameAuthorizationRequirement),
    ];

    public async Task<CallerFacts> ResolveAsync(
        HttpRequest? outerRequest, IReadOnlySet<string> policyNames, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(policyNames);

        await using SyntheticRequest synthetic = requests.Create(outerRequest, cancellationToken);
        IServiceProvider services = synthetic.Context.RequestServices;

        (CallerIdentity identity, ClaimsPrincipal? principal) = await AuthenticateAsync(synthetic.Context, services);
        Dictionary<string, VisibilityDecision> results = new(StringComparer.Ordinal);
        if (identity != CallerIdentity.Present || principal is null || policyNames.Count == 0)
        {
            return new CallerFacts(identity, results);
        }

        IAuthorizationPolicyProvider? policies = services.GetService<IAuthorizationPolicyProvider>();
        IAuthorizationService? authorization = services.GetService<IAuthorizationService>();
        foreach (string name in policyNames)
        {
            results[name] = await EvaluatePolicyAsync(name, principal, policies, authorization);
        }
        return new CallerFacts(identity, results);
    }

    private static async Task<(CallerIdentity, ClaimsPrincipal?)> AuthenticateAsync(
        HttpContext context, IServiceProvider services)
    {
        IAuthenticationSchemeProvider? schemes = services.GetService<IAuthenticationSchemeProvider>();
        IAuthenticationService? authentication = services.GetService<IAuthenticationService>();
        if (schemes is null || authentication is null)
        {
            return (CallerIdentity.Unknown, null);
        }
        AuthenticationScheme? scheme = await schemes.GetDefaultAuthenticateSchemeAsync();
        if (scheme is null)
        {
            return (CallerIdentity.Unknown, null);
        }

        AuthenticateResult result = await authentication.AuthenticateAsync(context, scheme.Name);
        return result.Succeeded && result.Principal?.Identity?.IsAuthenticated == true
            ? (CallerIdentity.Present, result.Principal)
            : (CallerIdentity.Absent, null);
    }

    private static async Task<VisibilityDecision> EvaluatePolicyAsync(
        string name,
        ClaimsPrincipal principal,
        IAuthorizationPolicyProvider? policies,
        IAuthorizationService? authorization)
    {
        if (authorization is null)
        {
            return VisibilityDecision.Unknown;
        }

        AuthorizationPolicy? policy;
        if (name.StartsWith(RolesPrefix, StringComparison.Ordinal))
        {
            string[] roles = name[RolesPrefix.Length..]
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            policy = roles.Length == 0 ? null : new AuthorizationPolicyBuilder().RequireRole(roles).Build();
        }
        else
        {
            policy = policies is null ? null : await policies.GetPolicyAsync(name);
        }

        if (policy is null || policy.Requirements.Any(r => !Evaluable.Contains(r.GetType())))
        {
            return VisibilityDecision.Unknown;
        }

        AuthorizationResult verdict = await authorization.AuthorizeAsync(principal, resource: null, policy);
        return verdict.Succeeded ? VisibilityDecision.Allow : VisibilityDecision.Deny;
    }
}
