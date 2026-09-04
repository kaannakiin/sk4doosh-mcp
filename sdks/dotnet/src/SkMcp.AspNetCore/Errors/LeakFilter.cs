using System.Text.RegularExpressions;

namespace SkMcp.AspNetCore.Errors;

internal enum LeakRule { StackFrame, ExceptionType, FilePath, ConnectionString, Credential, TooLong }

internal readonly record struct LeakVerdict(string Normalized, LeakRule? Rule);

internal static class LeakFilter
{
    private const int MaxForwardableLength = 1000;

    private static readonly Regex Whitespace = new(@"\s+", RegexOptions.Compiled);

    private static readonly (LeakRule Rule, Regex Pattern)[] Patterns =
    [
        (LeakRule.StackFrame, new Regex(@"(^|\s)at\s+[\w$.<>]+[\s.]*\(", RegexOptions.Compiled)),
        (LeakRule.StackFrame, new Regex(@"(^|\s)at\s+\S+:\d+:\d+\)?", RegexOptions.Compiled)),
        (LeakRule.StackFrame, new Regex(@"Traceback \(most recent call last\):", RegexOptions.Compiled)),
        (LeakRule.ExceptionType, new Regex(@"\b\w*Exception\b", RegexOptions.Compiled)),
        (LeakRule.ExceptionType, new Regex(@"\b(TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError)\b", RegexOptions.Compiled)),
        (LeakRule.FilePath, new Regex(@"[A-Za-z]:\\[^\s""]+", RegexOptions.Compiled)),
        (LeakRule.FilePath, new Regex(@"\\\\[^\s\\]+\\[^\s""]+", RegexOptions.Compiled)),
        (LeakRule.FilePath, new Regex(@"/(?:Users|home|var|usr|opt|srv|app|src|etc|tmp)/[^\s""]*", RegexOptions.Compiled)),
        (LeakRule.FilePath, new Regex(@"\.(?:cs|ts|tsx|js|jsx|py|java|rb|go|php|cpp|c|h|kt|swift):(?:line )?\d+", RegexOptions.Compiled | RegexOptions.IgnoreCase)),
        (LeakRule.ConnectionString, new Regex(@"\b(?:Server|Data Source|Password|User Id|Uid|Pwd|Initial Catalog)\s*=\s*[^;]+;", RegexOptions.Compiled | RegexOptions.IgnoreCase)),
        (LeakRule.ConnectionString, new Regex(@"\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|mssql)://", RegexOptions.Compiled | RegexOptions.IgnoreCase)),
        (LeakRule.ConnectionString, new Regex(@"://[^/\s:@]+:[^/\s:@]+@", RegexOptions.Compiled)),
        (LeakRule.Credential, new Regex(@"\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*", RegexOptions.Compiled | RegexOptions.IgnoreCase)),
        (LeakRule.Credential, new Regex(@"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", RegexOptions.Compiled)),
    ];

    public static LeakVerdict Inspect(string value)
    {
        string normalized = Whitespace.Replace(value, " ").Trim();
        foreach ((LeakRule rule, Regex pattern) in Patterns)
        {
            if (pattern.IsMatch(normalized))
            {
                return new LeakVerdict(normalized, rule);
            }
        }
        return normalized.Length > MaxForwardableLength
            ? new LeakVerdict(normalized, LeakRule.TooLong)
            : new LeakVerdict(normalized, null);
    }

    public static string? Forwardable(string value)
    {
        LeakVerdict verdict = Inspect(value);
        return verdict.Rule is null ? verdict.Normalized : null;
    }
}
