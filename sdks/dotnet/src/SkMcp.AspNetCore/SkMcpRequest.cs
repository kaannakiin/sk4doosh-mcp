using Microsoft.AspNetCore.Http;

namespace SkMcp.AspNetCore;

public static class SkMcpRequest
{
    private const string FlagKey = "sk-mcp.synthetic";

    public static bool IsSkMcpRequest(this HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return context.Items.ContainsKey(FlagKey);
    }

    internal static void Mark(HttpContext context) => context.Items[FlagKey] = true;
}
