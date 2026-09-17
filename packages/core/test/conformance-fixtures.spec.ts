import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compose,
  createCard,
  arraySeparatorFor,
  createRequestTemplate,
  createToolDefinition,
  createToolNames,
  expandToolProductions,
  routePlaceholderNames,
  evaluateVisibility,
  isSelected,
  mapInvokeResult,
  simplifySchema,
  SkMcpArgumentError,
  SkMcpCatalogError,
  SkMcpTemplateError,
  ToolIndex,
  type ArgumentFill,
  type BackendResponse,
  type CurationRelief,
  type EndpointDescriptor,
  type Fixture,
  type ParameterBinding,
  type RequestTemplate,
  type ToolDefinition,
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
  anonymous: "yes",
  policies: [],
  imperative: false,
};

function templateFrom(
  spec: FixtureOf<"argument-mapping">["input"]["template"],
): RequestTemplate {
  const bodyAliases = new Map<string, string>();
  const bodyFills = new Map<string, ArgumentFill>();
  for (const record of spec.body?.curation ?? []) {
    if (record.as !== undefined) {
      bodyAliases.set(record.as, record.name);
    }
    if (record.fill !== undefined) {
      bodyFills.set(record.name, record.fill as ArgumentFill);
    }
  }
  return createRequestTemplate({
    method: spec.method,
    route: spec.route,
    parameters: (spec.parameters ?? []).map((p): ParameterBinding => {
      const isArray = p.array === true;
      const arraySeparator = isArray
        ? arraySeparatorFor(p.style, p.explode, p.name)
        : undefined;
      return {
        name: p.name,
        location: p.in,
        kind: p.type,
        isArray,
        ...(arraySeparator === undefined ? {} : { arraySeparator }),
        ...(p.as === undefined ? {} : { argument: p.as }),
        ...(p.fill === undefined ? {} : { fill: p.fill as ArgumentFill }),
      };
    }),
    ...(spec.bodyRoot === undefined
      ? {
          bodyProperties: spec.body?.properties,
          bodyAllowsAdditionalProperties:
            spec.body?.additionalProperties === true,
          ...(bodyAliases.size === 0 ? {} : { bodyAliases }),
          ...(bodyFills.size === 0 ? {} : { bodyFills }),
        }
      : {
          bodyRoot: spec.bodyRoot,
          ...(spec.rootFill === undefined
            ? {}
            : { rootFill: spec.rootFill as ArgumentFill }),
        }),
  });
}

describe("conformance: argument-mapping", () => {
  for (const [file, fixture] of fixturesOf("argument-mapping")) {
    it(file, () => {
      const template = templateFrom(fixture.input.template);
      if ("error" in fixture.expected) {
        const expected = fixture.expected.error;
        try {
          compose(template, fixture.input.arguments, fixture.input.deferred);
          expect.unreachable(`expected error ${expected}`);
        } catch (error) {
          expect(error).toBeInstanceOf(SkMcpArgumentError);
          expect((error as SkMcpArgumentError).code).toBe(expected);
        }
      } else {
        const composed = compose(
          template,
          fixture.input.arguments,
          fixture.input.deferred,
        );
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
            ...(e.variants === undefined ? {} : { variants: e.variants }),
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

function templateErrorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SkMcpTemplateError);
    return (error as SkMcpTemplateError).code;
  }
  return expect.unreachable("expected a template error");
}

function reliefOf(
  fixture: FixtureOf<"metadata-extraction">,
): CurationRelief | undefined {
  if (fixture.foldedRoutes === undefined) {
    return undefined;
  }
  const foldedNames = new Set<string>();
  for (const route of fixture.foldedRoutes) {
    for (const name of routePlaceholderNames(route)) {
      foldedNames.add(name);
    }
  }
  for (const name of routePlaceholderNames(fixture.input.route)) {
    foldedNames.delete(name);
  }
  return { foldedNames, onUnused: () => {} };
}

function toolsOf(
  endpoint: EndpointDescriptor,
  relief: CurationRelief | undefined,
): ToolDefinition[] {
  return expandToolProductions([endpoint], (e) => e).map((production) =>
    createToolDefinition(
      production.endpoint,
      undefined,
      production.variant,
      relief,
    ),
  );
}

describe("conformance: metadata-extraction", () => {
  for (const [file, fixture] of fixturesOf("metadata-extraction")) {
    it(file, () => {
      const expected = fixture.expected;
      const relief = reliefOf(fixture);
      if ("error" in expected) {
        expect(templateErrorCode(() => toolsOf(fixture.input, relief))).toBe(
          expected.error,
        );
        return;
      }
      if ("tools" in expected) {
        expect(toolsOf(fixture.input, relief)).toEqual(expected.tools);
        return;
      }
      expect(
        createToolDefinition(fixture.input, undefined, undefined, relief),
      ).toEqual(expected);
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

function rawBody(
  body: FixtureOf<"error-mapping">["input"]["body"],
): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === "string" ? body : JSON.stringify(body);
}

function backendResponseFrom(
  input: FixtureOf<"error-mapping">["input"],
): BackendResponse {
  const body = rawBody(input.body);
  return {
    status: input.status,
    ...(input.contentType === undefined
      ? {}
      : { contentType: input.contentType }),
    headers: input.headers ?? {},
    ...(body === undefined ? {} : { body }),
  };
}

describe("conformance: error-mapping", () => {
  for (const [file, fixture] of fixturesOf("error-mapping")) {
    it(file, () => {
      const response = backendResponseFrom(fixture.input);
      const options = {
        ...(fixture.input.knownFields === undefined
          ? {}
          : { knownFields: fixture.input.knownFields }),
        ...(fixture.input.fieldAliases === undefined
          ? {}
          : { fieldAliases: fixture.input.fieldAliases }),
        ...(fixture.input.hiddenFields === undefined
          ? {}
          : { hiddenFields: fixture.input.hiddenFields }),
      };
      expect(mapInvokeResult(response, options)).toEqual(fixture.expected);
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
          ...(t.alternateRoutes === undefined
            ? {}
            : { alternateRoutes: t.alternateRoutes }),
        })),
      );
      expect(
        index.search(fixture.input.query, fixture.input.limit ?? 20),
      ).toEqual(fixture.expected.names);
    });
  }
});

describe("conformance: schema-simplification", () => {
  for (const [file, fixture] of fixturesOf("schema-simplification")) {
    it(file, () => {
      const { schema, diagnostics } = simplifySchema(
        fixture.input.shape,
        fixture.input.options,
      );
      expect(schema).toEqual(fixture.expected.schema);
      expect(diagnostics.map((entry) => entry.code)).toEqual(
        fixture.expected.diagnostics ?? [],
      );
      if (fixture.expected.defsOrder !== undefined) {
        expect(Object.keys(schema["$defs"] as object)).toEqual(
          fixture.expected.defsOrder,
        );
      }
    });
  }
});

describe("conformance: card", () => {
  for (const [file, fixture] of fixturesOf("card")) {
    it(file, () => {
      const card = createCard(
        fixture.input.tool as ToolDefinition,
        fixture.input.decision ?? "allow",
      );
      expect(card).toEqual(fixture.expected);
    });
  }
});
