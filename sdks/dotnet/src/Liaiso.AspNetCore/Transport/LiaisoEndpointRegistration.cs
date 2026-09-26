using Microsoft.AspNetCore.Http;

namespace Liaiso.AspNetCore.Transport;

internal sealed class LiaisoEndpointRegistration
{
    public PathString? Pattern { get; set; }
}
