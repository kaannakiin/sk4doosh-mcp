using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

public interface IMcpSelectionMetadata
{
    bool Include { get; }
}

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class McpToolAttribute : Attribute, IMcpSelectionMetadata
{
    private bool? _readOnly;
    private bool? _destructive;
    private bool? _idempotent;

    public bool Include => true;

    public bool ReadOnly
    {
        get => _readOnly ?? false;
        set => _readOnly = value;
    }

    public bool Destructive
    {
        get => _destructive ?? false;
        set => _destructive = value;
    }

    public bool Idempotent
    {
        get => _idempotent ?? false;
        set => _idempotent = value;
    }

    public ToolAnnotations Overrides => new()
    {
        ReadOnlyHint = _readOnly,
        DestructiveHint = _destructive,
        IdempotentHint = _idempotent,
    };
}

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class McpIgnoreAttribute : Attribute, IMcpSelectionMetadata
{
    public bool Include => false;
}
