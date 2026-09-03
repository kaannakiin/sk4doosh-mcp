using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;

namespace SkMcp.AspNetCore.Caching;

public interface ICallerScopeResolver
{
    CallerScope Resolve(HttpRequest? outerRequest);
}

public sealed class CarrierHashCallerScopeResolver(IOptions<SkMcpOptions> options) : ICallerScopeResolver
{
    public CallerScope Resolve(HttpRequest? outerRequest)
    {
        string key = DigestInput(options.Value.Identity.Carriers, name => Header(outerRequest, name));
        return new CallerScope(key, []);
    }

    public static string DigestInput(IEnumerable<string> carriers, Func<string, string?> header)
    {
        ArgumentNullException.ThrowIfNull(carriers);
        ArgumentNullException.ThrowIfNull(header);

        List<string> names = carriers.Select(c => c.ToLowerInvariant()).Distinct(StringComparer.Ordinal).ToList();
        names.Sort(StringComparer.Ordinal);

        StringBuilder input = new();
        foreach (string name in names)
        {
            input.Append(name).Append('=').Append(header(name) ?? string.Empty).Append('\n');
        }

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(input.ToString()));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string? Header(HttpRequest? request, string name)
    {
        if (request is null || !request.Headers.TryGetValue(name, out StringValues values) || values.Count == 0)
        {
            return null;
        }
        return string.Join(",", values.ToArray());
    }
}
