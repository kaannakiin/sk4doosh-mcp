using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Search;

namespace SkMcp.Tests;

public sealed class SearchParametersTests
{
    private static JsonObject Schema(string json) => (JsonObject)JsonNode.Parse(json)!;

    [Fact]
    public void P1_EmitsEachRootKeyAndItsStringDescription()
    {
        Assert.Equal(
            ["customerId", "Musteri numarasi", "page"],
            SearchParameters.From(Schema("""
                {
                  "type": "object",
                  "properties": {
                    "customerId": { "type": "integer", "description": "Musteri numarasi" },
                    "page": { "type": "integer" }
                  }
                }
                """)));
    }

    [Fact]
    public void P2_StopsAtTheRoot()
    {
        Assert.Equal(
            ["filter", "Filtre govdesi"],
            SearchParameters.From(Schema("""
                {
                  "type": "object",
                  "properties": {
                    "filter": {
                      "type": "object",
                      "description": "Filtre govdesi",
                      "properties": { "tenantId": { "type": "integer" } }
                    }
                  },
                  "$defs": { "TenantRef": { "properties": { "tenantCode": {} } } }
                }
                """)));
    }

    [Fact]
    public void P3_TreatsAMissingNullOrNonObjectPropertiesBagAsEmpty()
    {
        Assert.Empty(SearchParameters.From(null));
        Assert.Empty(SearchParameters.From(Schema("""{ "type": "object" }""")));
        Assert.Empty(SearchParameters.From(Schema("""{ "properties": {} }""")));
        Assert.Empty(SearchParameters.From(Schema("""{ "properties": null }""")));
        Assert.Empty(SearchParameters.From(Schema("""{ "properties": "ab" }""")));
        Assert.Empty(SearchParameters.From(Schema("""{ "properties": ["a", "b"] }""")));
    }

    [Fact]
    public void P4_KeepsTheKeyWhenTheMemberOrItsDescriptionIsNotUsable()
    {
        Assert.Equal(
            ["boolean", "nulled", "numeric", "objectish", "voided"],
            SearchParameters.From(Schema("""
                {
                  "properties": {
                    "boolean": true,
                    "nulled": null,
                    "numeric": { "description": 42 },
                    "objectish": { "description": { "text": "no" } },
                    "voided": { "description": null }
                  }
                }
                """)));
    }
}
