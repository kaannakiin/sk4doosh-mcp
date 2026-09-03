using System.Collections;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Discovery;

namespace SkMcp.Tests;

public sealed class MapHolder
{
    public Dictionary<string, string> Writable { get; set; } = [];
    public IReadOnlyDictionary<string, int> Readable { get; set; } = new Dictionary<string, int>();
    public IDictionary<string, string> Interface { get; set; } = new Dictionary<string, string>();
    public Hashtable Legacy { get; set; } = [];
}

public sealed class PairHolder
{
    public List<KeyValuePair<string, int>> Pairs { get; set; } = [];
}

public sealed class KeyedHolder
{
    public Dictionary<int, string> ByNumber { get; set; } = [];
    public Dictionary<Guid, string> ById { get; set; } = [];
    public Dictionary<KeyedHolder, string> ByPoco { get; set; } = [];
}

public sealed class BinaryHolder
{
    public byte[] Blob { get; set; } = [];
    public ReadOnlyMemory<byte> Span { get; set; }
}

public sealed class Node
{
    public string Name { get; set; } = string.Empty;
    public Node? Child { get; set; }
}

public sealed class DeepFour
{
    public DeepThree Level { get; set; } = new();
}

public sealed class DeepThree
{
    public DeepTwo Level { get; set; } = new();
}

public sealed class DeepTwo
{
    public DeepOne Level { get; set; } = new();
}

public sealed class DeepOne
{
    public string Leaf { get; set; } = string.Empty;
}

public abstract class BaseFields
{
    public string BaseOne { get; set; } = string.Empty;
    public string BaseTwo { get; set; } = string.Empty;
}

public sealed class DerivedFields : BaseFields
{
    public string DerivedOne { get; set; } = string.Empty;
    public string DerivedTwo { get; set; } = string.Empty;
}

public sealed record PositionalDto(
    [Required][property: Description("Not metni")] string Text,
    [Range(1, 100)] int Quantity,
    string? Note);

public sealed class AnnotatedDto
{
    [Required]
    [MinLength(2)]
    [MaxLength(8)]
    [Description("kullanici adi")]
    public string Name { get; set; } = string.Empty;

    [RegularExpression("^[a-z]+$")]
    public string Code { get; set; } = string.Empty;

    [EmailAddress]
    public string Mail { get; set; } = string.Empty;

    [MinLength(1)]
    public List<string> Tags { get; set; } = [];

    public string Optional { get; set; } = string.Empty;
}

public sealed class AuditDto
{
    public string Name { get; set; } = string.Empty;
    public DateTime CreationDate { get; } = DateTime.UnixEpoch;
    public int ModifiedByUserId { get; } = 1;
    public List<string> Tags { get; } = [];
    public Dictionary<string, string> Extras { get; } = [];
}

public sealed class CtorBoundDto
{
    public CtorBoundDto(string code) => Code = code;

    public string Code { get; }
}

public sealed class SchemaMapperTests
{
    private static JsonObject PropertyOf(Type type, string name) =>
        (JsonObject)((JsonObject)JsonSchemaMapper.Map(type)["properties"]!)[name]!;

    [Theory]
    [InlineData(typeof(string), "string", null)]
    [InlineData(typeof(char), "string", null)]
    [InlineData(typeof(bool), "boolean", null)]
    [InlineData(typeof(int), "integer", null)]
    [InlineData(typeof(long), "integer", null)]
    [InlineData(typeof(byte), "integer", null)]
    [InlineData(typeof(double), "number", null)]
    [InlineData(typeof(decimal), "number", null)]
    [InlineData(typeof(Guid), "string", "uuid")]
    [InlineData(typeof(DateTime), "string", "date-time")]
    [InlineData(typeof(DateTimeOffset), "string", "date-time")]
    [InlineData(typeof(DateOnly), "string", "date")]
    [InlineData(typeof(TimeSpan), "string", null)]
    [InlineData(typeof(Uri), "string", null)]
    [InlineData(typeof(int?), "integer", null)]
    public void J1_ScalarTable_MapsEveryPrimitive(Type type, string expected, string? format)
    {
        JsonObject schema = JsonSchemaMapper.Map(type);
        Assert.Equal(expected, schema["type"]!.GetValue<string>());
        Assert.Equal(format, schema["format"]?.GetValue<string>());
    }

    [Fact]
    public void J2_ByteArray_IsBase64String()
    {
        foreach (string name in new[] { "Blob", "Span" })
        {
            JsonObject schema = PropertyOf(typeof(BinaryHolder), name);
            Assert.Equal("string", schema["type"]!.GetValue<string>());
            Assert.Equal("base64", schema["contentEncoding"]!.GetValue<string>());
        }
    }

    [Fact]
    public void J3_Dictionary_IsObjectWithAdditionalProperties()
    {
        JsonObject writable = PropertyOf(typeof(MapHolder), "Writable");
        Assert.Equal("object", writable["type"]!.GetValue<string>());
        Assert.Equal("string", writable["additionalProperties"]!["type"]!.GetValue<string>());
        Assert.Null(writable["propertyNames"]);

        Assert.Equal(
            "integer",
            PropertyOf(typeof(MapHolder), "Readable")["additionalProperties"]!["type"]!.GetValue<string>());
        Assert.Equal(
            "string",
            PropertyOf(typeof(MapHolder), "Interface")["additionalProperties"]!["type"]!.GetValue<string>());
        Assert.Equal("object", PropertyOf(typeof(MapHolder), "Legacy")["type"]!.GetValue<string>());
    }

    [Fact]
    public void J4_KeyValuePairSequence_StaysArray()
    {
        JsonObject pairs = PropertyOf(typeof(PairHolder), "Pairs");
        Assert.Equal("array", pairs["type"]!.GetValue<string>());
        Assert.Equal("object", pairs["items"]!["type"]!.GetValue<string>());
        Assert.Null(pairs["additionalProperties"]);
    }

    [Fact]
    public void J5_NonStringDictionaryKey_EmitsPropertyNames()
    {
        JsonObject byNumber = PropertyOf(typeof(KeyedHolder), "ByNumber");
        Assert.Equal("string", byNumber["propertyNames"]!["type"]!.GetValue<string>());
        Assert.Equal("^-?[0-9]+$", byNumber["propertyNames"]!["pattern"]!.GetValue<string>());

        JsonObject byId = PropertyOf(typeof(KeyedHolder), "ById");
        Assert.Equal("uuid", byId["propertyNames"]!["format"]!.GetValue<string>());

        List<CatalogDiagnostic> reported = [];
        JsonObject schema = JsonSchemaMapper.Map(typeof(KeyedHolder), new SchemaMapperOptions
        {
            PropertyName = property => property.Name,
            Report = reported.Add,
        });
        JsonObject byPoco = (JsonObject)((JsonObject)schema["properties"]!)["ByPoco"]!;
        Assert.Equal("object", byPoco["type"]!.GetValue<string>());
        Assert.True(byPoco["additionalProperties"]!.GetValue<bool>());
        Assert.Null(byPoco["propertyNames"]);
        Assert.Contains(reported, d => d.Code == "unsupported_dictionary_key");
    }

    [Fact]
    public void J8_DepthLimit_And_Cycle_ProduceOpaque()
    {
        JsonObject level = JsonSchemaMapper.Map(typeof(DeepFour));
        for (int step = 0; step < 3; step++)
        {
            Assert.NotNull(level["properties"]);
            level = (JsonObject)((JsonObject)level["properties"]!)["Level"]!;
        }
        Assert.Equal("object", level["type"]!.GetValue<string>());
        Assert.Null(level["properties"]);

        JsonObject node = JsonSchemaMapper.Map(typeof(Node));
        JsonObject child = (JsonObject)((JsonObject)node["properties"]!)["Child"]!;
        Assert.Equal("object", child["type"]!.GetValue<string>());
        Assert.Null(child["properties"]);
    }

    [Fact]
    public void J10_PropertyOrder_IsDeclarationOrder_AcrossInheritance()
    {
        JsonObject properties = (JsonObject)JsonSchemaMapper.Map(typeof(DerivedFields))["properties"]!;
        Assert.Equal(
            ["BaseOne", "BaseTwo", "DerivedOne", "DerivedTwo"],
            properties.Select(p => p.Key).ToArray());
    }

    [Fact]
    public void J6_RequiredFrom_PropertyAttribute_And_PositionalRecordConstructor()
    {
        JsonObject schema = JsonSchemaMapper.Map(typeof(PositionalDto));
        Assert.Equal(["Text"], schema["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToArray());
        Assert.Equal("Not metni", PropertyOf(typeof(PositionalDto), "Text")["description"]!.GetValue<string>());
        Assert.Equal(1, PropertyOf(typeof(PositionalDto), "Quantity")["minimum"]!.GetValue<double>());
        Assert.Equal(100, PropertyOf(typeof(PositionalDto), "Quantity")["maximum"]!.GetValue<double>());
    }

    [Fact]
    public void J9_DataAnnotations_BecomeConstraints()
    {
        JsonObject schema = JsonSchemaMapper.Map(typeof(AnnotatedDto));
        Assert.Equal(["Name"], schema["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToArray());

        JsonObject name = PropertyOf(typeof(AnnotatedDto), "Name");
        Assert.Equal(2, name["minLength"]!.GetValue<int>());
        Assert.Equal(8, name["maxLength"]!.GetValue<int>());
        Assert.Equal("kullanici adi", name["description"]!.GetValue<string>());

        Assert.Equal("^[a-z]+$", PropertyOf(typeof(AnnotatedDto), "Code")["pattern"]!.GetValue<string>());
        Assert.Equal("email", PropertyOf(typeof(AnnotatedDto), "Mail")["format"]!.GetValue<string>());

        JsonObject tags = PropertyOf(typeof(AnnotatedDto), "Tags");
        Assert.Equal(1, tags["minItems"]!.GetValue<int>());
        Assert.Null(tags["minLength"]);

        Assert.Null(PropertyOf(typeof(AnnotatedDto), "Optional")["description"]);
    }

    [Fact]
    public void J21_NestedRequired_OmittedWhenEmpty()
    {
        JsonObject schema = JsonSchemaMapper.Map(typeof(MapHolder));
        Assert.Null(schema["required"]);
    }

    [Fact]
    public void J7_ReadOnlyProperties_DroppedExceptCollections()
    {
        JsonObject properties = (JsonObject)JsonSchemaMapper.Map(typeof(AuditDto))["properties"]!;
        Assert.Equal(["Name", "Tags", "Extras"], properties.Select(p => p.Key).ToArray());

        JsonObject kept = (JsonObject)JsonSchemaMapper.Map(typeof(AuditDto), new SchemaMapperOptions
        {
            PropertyName = property => property.Name,
            DropReadOnlyProperties = false,
        })["properties"]!;
        Assert.Contains("CreationDate", kept.Select(p => p.Key));
    }

    [Fact]
    public void J7b_GetOnlyProperty_BoundByConstructor_IsKept()
    {
        JsonObject properties = (JsonObject)JsonSchemaMapper.Map(typeof(CtorBoundDto))["properties"]!;
        Assert.Equal(["Code"], properties.Select(p => p.Key).ToArray());
    }
}
