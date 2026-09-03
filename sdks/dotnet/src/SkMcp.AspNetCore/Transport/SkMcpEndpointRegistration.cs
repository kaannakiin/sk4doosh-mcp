using Microsoft.AspNetCore.Http;

namespace SkMcp.AspNetCore.Transport;

internal sealed class SkMcpEndpointRegistration
{
    public PathString? Pattern { get; set; }
}
