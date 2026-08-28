import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compose,
  createRequestTemplate,
  SkMcpArgumentError,
  type Fixture,
  type ParameterBinding,
  type RequestTemplate,
} from "../src/index.js";

type ArgumentMappingFixture = Extract<Fixture, { kind: "argument-mapping" }>;

const fixturesDir = fileURLToPath(new URL("../../conformance/argument-mapping/", import.meta.url));
const files = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

function templateFrom(spec: ArgumentMappingFixture["input"]["template"]): RequestTemplate {
  return createRequestTemplate({
    method: spec.method,
    route: spec.route,
    parameters: (spec.parameters ?? []).map(
      (p): ParameterBinding => ({ name: p.name, location: p.in, kind: p.type, isArray: p.array === true }),
    ),
    bodyProperties: spec.body?.properties,
    bodyAllowsAdditionalProperties: spec.body?.additionalProperties === true,
  });
}

describe("conformance: argument-mapping", () => {
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    it(file, () => {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as ArgumentMappingFixture;
      expect(fixture.kind).toBe("argument-mapping");
      const template = templateFrom(fixture.input.template);

      if ("error" in fixture.expected) {
        const expected = fixture.expected.error;
        try {
          compose(template, fixture.input.arguments);
          expect.unreachable(`expected error ${expected}`);
        } catch (error) {
          expect(error).toBeInstanceOf(SkMcpArgumentError);
          expect((error as SkMcpArgumentError).code).toBe(expected);
        }
      } else {
        const composed = compose(template, fixture.input.arguments);
        expect(composed.pathAndQuery).toBe(fixture.expected.pathAndQuery);
        expect(composed.headers).toEqual(fixture.expected.headers ?? {});
        expect(composed.bodyJson).toEqual(fixture.expected.bodyJson);
      }
    });
  }
});
