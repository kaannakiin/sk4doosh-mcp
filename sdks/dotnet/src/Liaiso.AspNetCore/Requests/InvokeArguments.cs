using System.Text.Json;

namespace Liaiso.AspNetCore.Requests;

/// <summary>What <c>invoke_tool</c> will compose with, and whether the caller sent it that way.</summary>
/// <param name="Value">The value to compose with; <c>Undefined</c> stands for no arguments.</param>
/// <param name="Unwrapped">The caller sent JSON text and it was parsed into this object.</param>
internal readonly record struct NormalizedInvokeArguments(JsonElement Value, bool Unwrapped);

internal static class InvokeArguments
{
    /// <summary>
    /// Normalizes the <c>arguments</c> value <c>invoke_tool</c> received before composition.
    /// </summary>
    /// <remarks>
    /// Guard: the meta-tool publishes <c>arguments</c> with no type, so the transport hands the
    /// handler whatever arrived. Two shapes are accepted that
    /// <see cref="RequestComposer"/> itself refuses. <c>null</c> is absence — nothing downstream can
    /// tell it from an omitted object, because composition only enumerates properties. JSON
    /// <em>text</em> is a client defect, not an intent: no operation can want a string here, so
    /// parsing one is unambiguous. It is unwrapped rather than refused because the refusal costs the
    /// agent the whole turn, and <c>Unwrapped</c> is returned so the host can say so — silence would
    /// hide a client that double-encodes every call. The TS twin is
    /// <c>packages/core/src/invoke-arguments.ts</c>.
    /// </remarks>
    public static NormalizedInvokeArguments Normalize(JsonElement raw)
    {
        if (raw.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return new NormalizedInvokeArguments(default, false);
        }
        if (raw.ValueKind != JsonValueKind.String)
        {
            return new NormalizedInvokeArguments(raw, false);
        }
        string? text = raw.GetString();
        if (string.IsNullOrWhiteSpace(text))
        {
            return new NormalizedInvokeArguments(raw, false);
        }
        try
        {
            using JsonDocument parsed = JsonDocument.Parse(text);
            if (parsed.RootElement.ValueKind == JsonValueKind.Object)
            {
                return new NormalizedInvokeArguments(parsed.RootElement.Clone(), true);
            }
        }
        catch (JsonException)
        {
            return new NormalizedInvokeArguments(raw, false);
        }
        return new NormalizedInvokeArguments(raw, false);
    }
}
