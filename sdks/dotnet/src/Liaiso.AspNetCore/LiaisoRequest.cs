using Microsoft.AspNetCore.Http;

namespace Liaiso.AspNetCore;

public static class LiaisoRequest
{
    private const string FlagKey = "liaiso.synthetic";

    public static bool IsLiaisoRequest(this HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return context.Items.ContainsKey(FlagKey);
    }

    internal static void Mark(HttpContext context) => context.Items[FlagKey] = true;
}
