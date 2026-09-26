using System.Text.Json;
using System.Text.Json.Nodes;
using Liaiso.AspNetCore;
using Liaiso.AspNetCore.Spec;
using Liaiso.AspNetCore.Tools;
using Liaiso.AspNetCore.Visibility;

namespace Liaiso.Tests;

public sealed class CardSummaryTests
{
    private static string Summary(string inputSchema)
    {
        ToolDefinition tool = new()
        {
            Name = "probe",
            Description = "Probe.",
            InputSchema = (JsonObject)JsonNode.Parse(inputSchema)!,
            Annotations = new ToolAnnotations(),
            Auth = new Auth { Anonymous = Anonymity.Yes, Policies = [], Imperative = false },
        };
        JsonNode card = JsonSerializer.SerializeToNode(
            LiaisoMetaTools.CardFor(tool, VisibilityDecision.Allow), LiaisoJson.Wire)!;
        return card["parameters"]!.GetValue<string>();
    }

    [Fact]
    public void D1_NamesEachPropertyWithItsTypeAndMarksTheRequiredOnes()
    {
        Assert.Equal(
            "id: integer (required), note: string",
            Summary("""
                {
                  "type": "object",
                  "properties": { "id": { "type": "integer" }, "note": { "type": "string" } },
                  "required": ["id"]
                }
                """));
    }

    [Fact]
    public void D2_TreatsAMissingNullOrNonObjectPropertiesBagAsEmpty()
    {
        Assert.Equal("", Summary("""{ "type": "object" }"""));
        Assert.Equal("", Summary("""{ "properties": {} }"""));
        Assert.Equal("", Summary("""{ "properties": null }"""));
        Assert.Equal("", Summary("""{ "properties": "ab" }"""));
        Assert.Equal("", Summary("""{ "properties": ["a", "b"] }"""));
    }

    [Fact]
    public void D3_FallsBackToAnyWhenTheMemberOrItsTypeIsNotUsable()
    {
        Assert.Equal(
            "boolean: any, nulled: any, typeless: any, numericType: any, nullUnion: any",
            Summary("""
                {
                  "properties": {
                    "boolean": true,
                    "nulled": null,
                    "typeless": {},
                    "numericType": { "type": 42 },
                    "nullUnion": { "type": ["null"] }
                  }
                }
                """));
    }

    [Fact]
    public void D4_SkipsANonStringUnionMemberRatherThanNamingIt()
    {
        Assert.Equal(
            "mixed: string",
            Summary("""{ "properties": { "mixed": { "type": [42, "string"] } } }"""));
    }

    [Fact]
    public void D5_IgnoresARequiredListThatIsNotAnArrayOfStrings()
    {
        Assert.Equal(
            "id: integer",
            Summary("""{ "properties": { "id": { "type": "integer" } }, "required": "id" }"""));
        Assert.Equal(
            "id: integer",
            Summary("""{ "properties": { "id": { "type": "integer" } }, "required": [42] }"""));
    }
}
