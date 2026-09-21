using System.Text.RegularExpressions;

namespace SkMcp.AspNetCore.Discovery;

internal static class RouteGlob
{
    /// <summary>A <c>*</c> matches within one segment, <c>**</c> across segments.</summary>
    /// <remarks>
    /// Every regex metacharacter outside the two wildcards is escaped before it can turn a
    /// host-written pattern into a catastrophic backtracker; the timeout bounds what escaping
    /// cannot. Route templates carry <c>{id}</c> placeholders, so the braces reach that escape on
    /// every ordinary pattern.
    /// </remarks>
    public static bool Matches(string pattern, string route)
    {
        string source = string.Join(".*", pattern.Split("**")
            .Select(part => string.Join("[^/]*", part.Split('*').Select(Regex.Escape))));
        return Regex.IsMatch(
            route, $"^{source}$", RegexOptions.None, TimeSpan.FromSeconds(1));
    }
}
