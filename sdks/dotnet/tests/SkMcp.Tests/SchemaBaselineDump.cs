using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using SkMcp.AspNetCore.Discovery;
using Xunit.Abstractions;

namespace SkMcp.Tests;

public sealed class Address
{
    [MinLength(3)]
    [MaxLength(80)]
    public string Street { get; set; } = string.Empty;

    public Country Country { get; set; }
}

public enum Country
{
    Tr,
    De,
}

[Flags]
public enum Channels
{
    None = 0,
    Web = 1,
    Mobile = 2,
}

public sealed class SharedTypeDto
{
    public Address Billing { get; set; } = new();
    public Address Shipping { get; set; } = new();
    public Preferences Preferences { get; set; } = new();
}

public sealed class Preferences
{
    public bool Newsletter { get; set; }
}

public sealed class MutualLeft
{
    public string Name { get; set; } = string.Empty;
    public MutualRight? Right { get; set; }
}

public sealed class MutualRight
{
    public int Count { get; set; }
    public MutualLeft? Left { get; set; }
}

public sealed class ApiResponse<T>
{
    public T? Data { get; set; }
    public bool Succeeded { get; set; }
}

public sealed class OpaqueValueDto
{
    public object Anything { get; set; } = new();
    public Dictionary<string, object> Bag { get; set; } = [];
}

public sealed class SchemaBaselineDump(ITestOutputHelper output)
{
    private static readonly (string Label, Type Type)[] Cases =
    [
        ("deep-four-levels", typeof(DeepFour)),
        ("self-recursive", typeof(Node)),
        ("mutually-recursive", typeof(MutualLeft)),
        ("shared-type-twice", typeof(SharedTypeDto)),
        ("dictionaries", typeof(MapHolder)),
        ("dictionary-keys", typeof(KeyedHolder)),
        ("key-value-pair-list", typeof(PairHolder)),
        ("data-annotations", typeof(AnnotatedDto)),
        ("positional-record", typeof(PositionalDto)),
        ("readonly-members", typeof(AuditDto)),
        ("ctor-bound-readonly", typeof(CtorBoundDto)),
        ("binary", typeof(BinaryHolder)),
        ("member-order", typeof(DerivedFields)),
        ("body-root-array", typeof(List<int>)),
        ("body-root-scalar", typeof(string)),
        ("generic-wrapper", typeof(ApiResponse<Address>)),
        ("object-typed-members", typeof(OpaqueValueDto)),
    ];

    private static readonly (string Label, JsonSerializerOptions Options)[] EnumHosts =
    [
        ("default-numeric", new JsonSerializerOptions()),
        ("string-enum-camel", CamelCaseStringEnum()),
        ("string-enum-plain", new JsonSerializerOptions { Converters = { new JsonStringEnumConverter() } }),
    ];

    private static JsonSerializerOptions CamelCaseStringEnum() =>
        new() { Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) } };

    [Fact]
    public void Dump()
    {
        string? target = Environment.GetEnvironmentVariable("SKMCP_SCHEMA_DUMP");
        if (string.IsNullOrWhiteSpace(target))
        {
            output.WriteLine("SKMCP_SCHEMA_DUMP not set; nothing to measure.");
            return;
        }

        JsonObject report = [];

        JsonObject types = [];
        foreach ((string label, Type type) in Cases)
        {
            List<CatalogDiagnostic> diagnostics = [];
            JsonObject schema = JsonSchemaMapper.Map(type, new SchemaMapperOptions
            {
                PropertyName = property => property.Name,
                Report = diagnostics.Add,
            });
            JsonObject entry = new() { ["schema"] = schema };
            if (diagnostics.Count > 0)
            {
                entry["diagnostics"] = new JsonArray(
                    diagnostics.Select(d => (JsonNode)d.Code).ToArray());
            }
            types[label] = entry;
        }
        report["types"] = types;

        JsonObject enums = [];
        foreach ((string label, JsonSerializerOptions options) in EnumHosts)
        {
            enums[$"{label}/plain"] = SchemaWriter.EnumSchemaFor(
                EnumWireFormat.Describe(typeof(Country), options));
            enums[$"{label}/flags"] = SchemaWriter.EnumSchemaFor(
                EnumWireFormat.Describe(typeof(Channels), options));
        }
        enums["unresolved/plain"] = SchemaWriter.EnumSchemaFor(
            EnumWireFormat.Unresolved(typeof(Country)));
        enums["unresolved/flags"] = SchemaWriter.EnumSchemaFor(
            EnumWireFormat.Unresolved(typeof(Channels)));
        report["enums"] = enums;

        File.WriteAllText(target, report.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }
}
