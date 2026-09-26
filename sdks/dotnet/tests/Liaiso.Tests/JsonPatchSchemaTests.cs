using System.Text.Json.Nodes;
using Microsoft.AspNetCore.JsonPatch;
using Liaiso.AspNetCore.Discovery;

namespace Liaiso.Tests
{
    public sealed class PatchedOrder
    {
        public string? Status { get; set; }
    }

    public sealed class OrderPatch : JsonPatchDocument<PatchedOrder>;

    public sealed class PatchHolder
    {
        public JsonPatchDocument? Patch { get; set; }
    }

    public sealed class JsonPatchSchemaTests
    {
        internal const string OperationsSchema = """
            {
              "type": "array",
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["op", "path", "value"],
                    "properties": {
                      "op": { "type": "string", "enum": ["add", "replace", "test"] },
                      "path": { "type": "string" },
                      "value": {}
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["op", "path", "from"],
                    "properties": {
                      "op": { "type": "string", "enum": ["move", "copy"] },
                      "path": { "type": "string" },
                      "from": { "type": "string" }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["op", "path"],
                    "properties": {
                      "op": { "type": "string", "enum": ["remove"] },
                      "path": { "type": "string" }
                    }
                  }
                ]
              }
            }
            """;

        private static void AssertOperations(JsonNode? actual) =>
            Assert.True(
                JsonNode.DeepEquals(JsonNode.Parse(OperationsSchema), actual),
                actual?.ToJsonString());

        [Theory]
        [InlineData(typeof(JsonPatchDocument<PatchedOrder>))]
        [InlineData(typeof(JsonPatchDocument))]
        [InlineData(typeof(OrderPatch))]
#if NET10_0_OR_GREATER
        [InlineData(typeof(Microsoft.AspNetCore.JsonPatch.SystemTextJson.JsonPatchDocument<PatchedOrder>))]
        [InlineData(typeof(Microsoft.AspNetCore.JsonPatch.SystemTextJson.JsonPatchDocument))]
#endif
        public void JP1_AJsonPatchDocumentIsReflectedAsItsRfc6902OperationArray(Type type) =>
            AssertOperations(JsonSchemaMapper.Map(type));

        [Fact]
        public void JP2_AJsonPatchDocumentMemberIsReflectedInline() =>
            AssertOperations(JsonSchemaMapper.Map(typeof(PatchHolder))["properties"]!["Patch"]);

        [Fact]
        public void JP3_AHostTypeSchemaStillWins()
        {
            JsonObject declared = new() { ["type"] = "array" };
            JsonObject schema = JsonSchemaMapper.Map(typeof(JsonPatchDocument<PatchedOrder>), new SchemaMapperOptions
            {
                PropertyName = property => property.Name,
                TypeSchema = type => type == typeof(JsonPatchDocument<PatchedOrder>) ? declared : null,
            });
            Assert.True(JsonNode.DeepEquals(declared, schema), schema.ToJsonString());
        }

        [Fact]
        public void JP4_ALookalikeOutsideTheJsonPatchNamespacesIsAnOrdinaryObject()
        {
            JsonObject schema = JsonSchemaMapper.Map(typeof(Lookalike.JsonPatchDocument<PatchedOrder>));
            Assert.NotEqual("array", schema["type"]?.GetValue<string>());
        }
    }
}

namespace Liaiso.Tests.Lookalike
{
    public sealed class JsonPatchDocument<T>
    {
        public List<T> Operations { get; set; } = [];
    }
}
