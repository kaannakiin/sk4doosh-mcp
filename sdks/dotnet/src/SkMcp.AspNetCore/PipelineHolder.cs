using Microsoft.AspNetCore.Http;

namespace SkMcp.AspNetCore;

internal sealed class PipelineHolder
{
    public RequestDelegate? Pipeline { get; set; }

    public bool Registered { get; set; }
}
