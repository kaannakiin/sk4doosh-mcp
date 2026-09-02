namespace SkMcp.AspNetCore.Search;

public sealed record SearchDocument(
    string Name, string? Description, IReadOnlyList<string> Tags, string Route);

public sealed class ToolIndex
{
    public const double NameWeight = 3.0;
    public const double DescriptionWeight = 1.5;
    public const double TagWeight = 1.0;
    public const double RouteWeight = 1.0;
    private const double K1 = 1.2;
    private const double B = 0.75;

    private sealed record IndexedDocument(string Name, Dictionary<string, double> Terms, double Length);

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
            foreach (string tag in document.Tags)
            {
                Accumulate(terms, tag, TagWeight);
            }
            Accumulate(terms, document.Route, RouteWeight);

            _documents.Add(new IndexedDocument(document.Name, terms, terms.Values.Sum()));
        }

        _averageLength = _documents.Count == 0 ? 0 : _documents.Average(d => d.Length);
    }

    public int Count => _documents.Count;

    public IReadOnlyList<string> Search(string? query, int limit)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(limit);

        IReadOnlyList<string> queryTerms = Tokenize(query);
        if (queryTerms.Count == 0)
        {
            return _documents.Select(d => d.Name)
                .Order(StringComparer.Ordinal)
                .Take(limit)
                .ToArray();
        }

        Dictionary<string, int> matchingDocuments = new(StringComparer.Ordinal);
        foreach (string term in queryTerms)
        {
            matchingDocuments[term] = _documents.Count(d => Frequency(d, term) > 0);
        }

        List<(string Name, double Score)> scored = [];
        foreach (IndexedDocument document in _documents)
        {
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
        System.Text.StringBuilder current = new();
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
            current.Append(char.ToLowerInvariant(character));
        }
        Flush(tokens, current);
        return tokens;
    }

    private static void Flush(List<string> tokens, System.Text.StringBuilder current)
    {
        if (current.Length >= 2)
        {
            string token = current.ToString();
            if (token.Length > 3 && token.EndsWith('s'))
            {
                token = token[..^1];
            }
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
