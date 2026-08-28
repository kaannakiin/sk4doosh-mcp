using Microsoft.AspNetCore.Http;

namespace SkMcp.AspNetCore;

public sealed class PipelineHolder
{
    public RequestDelegate? Pipeline { get; set; }
}
