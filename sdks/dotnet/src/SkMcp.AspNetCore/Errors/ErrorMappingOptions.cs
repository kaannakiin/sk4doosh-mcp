namespace SkMcp.AspNetCore.Errors;

public sealed class ErrorMappingOptions
{
    private readonly List<ErrorRecognizer> _recognizers = [];

    public IReadOnlyList<ErrorRecognizer> Recognizers => _recognizers;

    public ErrorMappingOptions Recognize(ErrorRecognizer recognizer)
    {
        ArgumentNullException.ThrowIfNull(recognizer);
        _recognizers.Add(recognizer);
        return this;
    }
}
