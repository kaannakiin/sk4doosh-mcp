using System.Globalization;
using System.Text;

namespace SkMcp.AspNetCore.Search;

internal sealed record SearchDocument(
    string Name, string? Description, IReadOnlyList<string> Tags, string Route,
    IReadOnlyList<string>? AlternateRoutes = null,
    IReadOnlyList<string>? Parameters = null);

internal sealed class ToolIndex
{
    public const double NameWeight = 3.0;
    public const double DescriptionWeight = 1.5;
    public const double TagWeight = 1.0;
    public const double RouteWeight = 1.0;
    public const double ParameterWeight = 1.0;
    private const double K1 = 1.2;
    private const double B = 0.75;

    private sealed record IndexedDocument(
        string Name, Dictionary<string, double> Terms, double Length, HashSet<string> Tags);

    private readonly List<IndexedDocument> _documents = [];
    private readonly double _averageLength;

    public ToolIndex(IEnumerable<SearchDocument> documents)
    {
        ArgumentNullException.ThrowIfNull(documents);

        foreach (SearchDocument document in documents)
        {
            Dictionary<string, double> terms = new(StringComparer.Ordinal);
            Accumulate(terms, document.Name, NameWeight);
            Accumulate(terms, document.Description, DescriptionWeight);
            HashSet<string> foldedTags = new(StringComparer.Ordinal);
            foreach (string tag in document.Tags)
            {
                Accumulate(terms, tag, TagWeight);
                foldedTags.Add(FoldToken(tag));
            }
            Accumulate(terms, document.Route, RouteWeight);
            foreach (string alternate in document.AlternateRoutes ?? [])
            {
                Accumulate(terms, alternate, RouteWeight);
            }
            foreach (string parameter in document.Parameters ?? [])
            {
                Accumulate(terms, parameter, ParameterWeight);
            }

            _documents.Add(new IndexedDocument(document.Name, terms, terms.Values.Sum(), foldedTags));
        }

        _averageLength = _documents.Count == 0 ? 0 : _documents.Average(d => d.Length);
    }

    public int Count => _documents.Count;

    public IReadOnlyList<string> Search(string? query, int limit, IReadOnlyList<string>? tags = null)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(limit);

        HashSet<string>? required = tags is null || tags.Count == 0
            ? null
            : new HashSet<string>(tags.Select(FoldToken), StringComparer.Ordinal);

        IReadOnlyList<string> queryTerms = Tokenize(query);
        if (queryTerms.Count == 0)
        {
            return _documents.Where(d => Survives(d, required))
                .Select(d => d.Name)
                .Order(StringComparer.Ordinal)
                .Take(limit)
                .ToArray();
        }

        // Guard: df counts the whole corpus. Narrowing by tag before this loop raises idf for
        // every term the removed documents carried, so a tags argument would reorder the tools it
        // did not remove. Pinned by tag-filter-preserves-document-frequency.json.
        Dictionary<string, int> matchingDocuments = new(StringComparer.Ordinal);
        foreach (string term in queryTerms)
        {
            matchingDocuments[term] = _documents.Count(d => Frequency(d, term) > 0);
        }

        List<(string Name, double Score)> scored = [];
        foreach (IndexedDocument document in _documents)
        {
            if (!Survives(document, required))
            {
                continue;
            }
            double score = 0;
            foreach (string term in queryTerms)
            {
                double frequency = Frequency(document, term);
                if (frequency <= 0)
                {
                    continue;
                }
                int df = matchingDocuments[term];
                double idf = Math.Log(1 + (_documents.Count - df + 0.5) / (df + 0.5));
                double normalized = frequency * (K1 + 1)
                    / (frequency + K1 * (1 - B + B * document.Length / _averageLength));
                score += idf * normalized;
            }
            if (score > 0)
            {
                scored.Add((document.Name, score));
            }
        }

        return scored
            .OrderByDescending(s => s.Score)
            .ThenBy(s => s.Name, StringComparer.Ordinal)
            .Take(limit)
            .Select(s => s.Name)
            .ToArray();
    }

    private static bool Survives(IndexedDocument document, HashSet<string>? required) =>
        required is null || required.All(document.Tags.Contains);

    public const int PrefixMinimumLength = 3;

    private static double Frequency(IndexedDocument document, string queryTerm)
    {
        if (queryTerm.Length < PrefixMinimumLength)
        {
            return document.Terms.GetValueOrDefault(queryTerm);
        }
        double total = 0;
        foreach ((string term, double frequency) in document.Terms)
        {
            if (term.StartsWith(queryTerm, StringComparison.Ordinal))
            {
                total += frequency;
            }
        }
        return total;
    }

    public static IReadOnlyList<string> Tokenize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        List<string> tokens = [];
        StringBuilder current = new();
        for (int index = 0; index < text.Length; index++)
        {
            char character = text[index];
            if (!char.IsLetterOrDigit(character))
            {
                Flush(tokens, current);
                continue;
            }
            bool boundary = index > 0
                && char.IsUpper(character)
                && (char.IsLower(text[index - 1])
                    || (char.IsUpper(text[index - 1])
                        && index + 1 < text.Length
                        && char.IsLower(text[index + 1])));
            if (boundary)
            {
                Flush(tokens, current);
            }
            current.Append(character);
        }
        Flush(tokens, current);
        return tokens;
    }

    /// <summary>
    /// Normalises an arbitrary string for comparison: NFD, drop non-spacing marks, lowercase, fold
    /// final sigma, NFC.
    /// </summary>
    /// <remarks>
    /// Guard: Greek writes one uppercase sigma and two lowercase ones, medial <c>σ</c> and final
    /// <c>ς</c>, so lowercasing <c>Σ</c> is a context-dependent choice. JavaScript's
    /// <c>toLowerCase</c> applies Unicode's conditional Final_Sigma rule and
    /// <c>ToLowerInvariant</c> does not, which indexed <c>ΟΔΟΣ</c> as <c>οδος</c> on one side and
    /// <c>οδοσ</c> on the other. NFD cannot reconcile them the way it reconciles the dotted
    /// <c>İ</c>: neither sigma decomposes. Unicode's own case folding settles the direction
    /// (CaseFolding.txt <c>03C2; C; 03C3</c>).
    /// </remarks>
    public static string FoldToken(string text)
    {
        string decomposed = text.Normalize(NormalizationForm.FormD);
        StringBuilder stripped = new(decomposed.Length);
        foreach (char character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
            {
                stripped.Append(character);
            }
        }
        return stripped.ToString()
            .ToLowerInvariant()
            .Replace('\u03C2', '\u03C3')
            .Normalize(NormalizationForm.FormC);
    }

    private static void Flush(List<string> tokens, StringBuilder current)
    {
        string folded = FoldToken(current.ToString());
        if (folded.Length >= 2)
        {
            string token = folded.Length > 3 && folded.EndsWith('s')
                ? folded[..^1]
                : folded;
            tokens.Add(token);
        }
        current.Clear();
    }

    private static void Accumulate(Dictionary<string, double> terms, string? text, double weight)
    {
        foreach (string token in Tokenize(text))
        {
            terms[token] = terms.GetValueOrDefault(token) + weight;
        }
    }
}
