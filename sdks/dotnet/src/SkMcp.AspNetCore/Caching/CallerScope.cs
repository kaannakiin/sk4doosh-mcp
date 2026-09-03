namespace SkMcp.AspNetCore.Caching;

public sealed record CallerScope(string Key, IReadOnlyList<string> Tags)
{
    public string Key { get; init; } = ValidateKey(Key);

    public IReadOnlyList<string> Tags { get; init; } = ValidateTags(Tags);

    private static string ValidateKey(string key)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        if (key.Any(char.IsWhiteSpace) || key.Contains(':'))
        {
            throw new ArgumentException("CallerScope key must not contain whitespace or ':'.", nameof(key));
        }
        return key;
    }

    private static IReadOnlyList<string> ValidateTags(IReadOnlyList<string> tags)
    {
        ArgumentNullException.ThrowIfNull(tags);
        foreach (string tag in tags)
        {
            if (string.IsNullOrEmpty(tag) || tag.Any(char.IsWhiteSpace) || !tag.Contains(':'))
            {
                throw new ArgumentException(
                    $"CallerScope tag '{tag}' must be 'kind:value' with no whitespace.", nameof(tags));
            }
        }
        return tags;
    }
}
