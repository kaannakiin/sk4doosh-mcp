namespace SkMcp.AspNetCore.Discovery;

public enum SelectionDefault { Exclude, Include }

internal enum SelectionMarker { Include, Exclude, Both }

internal static class SelectionResolver
{
    public static bool IsSelected(
        SelectionDefault defaultDecision,
        SelectionMarker? container,
        SelectionMarker? operation,
        string? describedAs = null)
    {
        Reject(container, "container", describedAs);
        Reject(operation, "operation", describedAs);

        if (operation is not null)
        {
            return operation == SelectionMarker.Include;
        }
        if (container is not null)
        {
            return container == SelectionMarker.Include;
        }
        return defaultDecision == SelectionDefault.Include;
    }

    public static SelectionMarker? Combine(bool include, bool exclude) => (include, exclude) switch
    {
        (true, true) => SelectionMarker.Both,
        (true, false) => SelectionMarker.Include,
        (false, true) => SelectionMarker.Exclude,
        (false, false) => null,
    };

    private static void Reject(SelectionMarker? marker, string level, string? describedAs)
    {
        if (marker != SelectionMarker.Both)
        {
            return;
        }
        string target = describedAs is null ? string.Empty : $" on {describedAs}";
        throw new SkMcpCatalogException(
            SkMcpCatalogException.AmbiguousSelection,
            $"Both include and exclude markers are present at the {level} level{target}; remove one of them.");
    }
}
