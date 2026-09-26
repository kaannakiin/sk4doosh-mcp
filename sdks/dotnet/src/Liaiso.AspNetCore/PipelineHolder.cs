using Microsoft.AspNetCore.Http;

namespace Liaiso.AspNetCore;

internal sealed class PipelineHolder
{
    public RequestDelegate? Pipeline { get; set; }

    public bool Registered { get; set; }
}
