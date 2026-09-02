import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compose,
  createRequestTemplate,
  createToolDefinition,
  createToolNames,
  evaluateVisibility,
  isSelected,
  SkMcpArgumentError,
  SkMcpCatalogError,
  ToolIndex,
  type EndpointDescriptor,
  type Fixture,
  type ParameterBinding,
  type RequestTemplate,
} from "../src/index.js";

type FixtureOf<K extends Fixture["kind"]> = Extract<Fixture, { kind: K }>;

function fixturesOf<K extends Fixture["kind"]>(
  kind: K,
): Array<[string, FixtureOf<K>]> {
  const dir = fileURLToPath(
    new URL(`../../conformance/${kind}/`, import.meta.url),
  );
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  return files.map((file) => {
    const fixture = JSON.parse(
      readFileSync(join(dir, file), "utf8"),
    ) as Fixture;
    expect(fixture.kind).toBe(kind);
    return [file, fixture as FixtureOf<K>];
  });
}

function catalogErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SkMcpCatalogError);
    return (error as SkMcpCatalogError).code;
  }
  return expect.unreachable("expected a catalog error");
}

const unusedAuth: EndpointDescriptor["auth"] = {
  anonymous: true,
  policies: [],
  imperative: false,
};

function templateFrom(
  spec: FixtureOf<"argument-mapping">["input"]["template"],
): RequestTemplate {
  return createRequestTemplate({
    method: spec.method,
    route: spec.route,
    parameters: (spec.parameters ?? []).map((p): ParameterBinding => ({
      name: p.name,
      location: p.in,
      kind: p.type,
      isArray: p.array === true,
    })),
    bodyProperties: spec.body?.properties,
    bodyAllowsAdditionalProperties: spec.body?.additionalProperties === true,
  });
}

describe("conformance: argument-mapping", () => {
  for (const [file, fixture] of fixturesOf("argument-mapping")) {
    it(file, () => {
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

describe("conformance: naming", () => {
  for (const [file, fixture] of fixturesOf("naming")) {
    it(file, () => {
      const hostPrefixes = fixture.input.hostPrefixes ?? {};
      const endpoints: EndpointDescriptor[] = fixture.input.endpoints.map(
        (e) => {
          const declared =
            e.containerPrefix ??
            (e.container === undefined ? undefined : hostPrefixes[e.container]);
          return {
            ...(e.operationId === undefined
              ? {}
              : { operationId: e.operationId }),
            ...(e.container === undefined ? {} : { container: e.container }),
            ...(declared === undefined ? {} : { containerPrefix: declared }),
            ...(e.toolName === undefined ? {} : { toolName: e.toolName }),
            method: e.method,
            route: e.route,
            auth: unusedAuth,
          };
        },
      );
      const options = { prefixMode: fixture.input.prefixMode ?? "always" };
      if ("error" in fixture.expected) {
        expect(
          catalogErrorCode(() => createToolNames(endpoints, options)),
        ).toBe(fixture.expected.error);
      } else {
        expect(createToolNames(endpoints, options)).toEqual(
          fixture.expected.names,
        );
      }
    });
  }
});

describe("conformance: selection", () => {
  for (const [file, fixture] of fixturesOf("selection")) {
    it(file, () => {
      const select = (): string[] =>
        fixture.input.operations
          .filter((o) =>
            isSelected(fixture.input.default, o.container, o.operation, o.id),
          )
          .map((o) => o.id);
      if ("error" in fixture.expected) {
        expect(catalogErrorCode(select)).toBe(fixture.expected.error);
      } else {
        expect(select()).toEqual(fixture.expected.selected);
      }
    });
  }
});

describe("conformance: metadata-extraction", () => {
  for (const [file, fixture] of fixturesOf("metadata-extraction")) {
    it(file, () => {
      expect(createToolDefinition(fixture.input)).toEqual(fixture.expected);
    });
  }
});

describe("conformance: visibility", () => {
  for (const [file, fixture] of fixturesOf("visibility")) {
    it(file, () => {
      expect(evaluateVisibility(fixture.input.auth, fixture.input.caller)).toBe(
        fixture.expected.decision,
      );
    });
  }
});

describe("conformance: search", () => {
  for (const [file, fixture] of fixturesOf("search")) {
    it(file, () => {
      const index = new ToolIndex(
        fixture.input.tools.map((t) => ({
          name: t.name,
          ...(t.description === undefined
            ? {}
            : { description: t.description }),
          ...(t.tags === undefined ? {} : { tags: t.tags }),
          route: t.route,
        })),
      );
      expect(
        index.search(fixture.input.query, fixture.input.limit ?? 20),
      ).toEqual(fixture.expected.names);
    });
  }
});
