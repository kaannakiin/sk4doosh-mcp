namespace SkMcp.AspNetCore.Discovery;

internal sealed record SchemaWriterOptions
{
    public bool DropReadOnlyProperties { get; init; } = true;

    public int? MaxDepth { get; init; }

    public Action<CatalogDiagnostic>? Report { get; init; }
}
