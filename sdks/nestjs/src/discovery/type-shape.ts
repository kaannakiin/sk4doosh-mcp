import { createRequire } from "node:module";
import type {
  Constraints,
  Member,
  ObjectType,
  ScalarKind,
  TypeNode,
  TypeShape,
} from "@sk-mcp/core";

const load = createRequire(import.meta.url);

export interface TypeShapeDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface TypeShapeBinderOptions {
  readonly typeShape?: (
    target: NewableFunction,
  ) => TypeShape | TypeNode | undefined;
  readonly report?: (diagnostic: TypeShapeDiagnostic) => void;
}

interface ValidationEntry {
  readonly propertyName: string;
  readonly type: string;
  readonly name?: string;
  readonly constraints?: readonly unknown[];
  readonly each?: boolean;
}

function scalar(kind: ScalarKind, format?: string): TypeNode {
  return format === undefined
    ? { kind: "scalar", scalar: kind }
    : { kind: "scalar", scalar: kind, format };
}

function unreadable(reason: string): TypeNode {
  return { kind: "unknown", reason };
}

const byConstructor = new Map<unknown, () => TypeNode>([
  [String, () => scalar("string")],
  [Number, () => scalar("number")],
  [Boolean, () => scalar("boolean")],
  [Date, () => scalar("string", "date-time")],
]);

export class NestTypeShapeBinder {
  private readonly types: Record<string, ObjectType> = {};
  private readonly keys = new Map<NewableFunction, string>();

  constructor(private readonly options: TypeShapeBinderOptions = {}) {}

  bind(target: unknown): TypeShape {
    return { root: this.node(target, undefined), types: this.types };
  }

  private node(target: unknown, owner: string | undefined): TypeNode {
    if (typeof target !== "function") {
      return unreadable(
        owner === undefined
          ? "No runtime type is available for this body."
          : `No runtime type is available for member '${owner}'.`,
      );
    }
    const declared = this.options.typeShape?.(target as NewableFunction);
    if (declared !== undefined) {
      return "root" in declared ? declared.root : declared;
    }
    const mapped = byConstructor.get(target);
    if (mapped !== undefined) {
      return mapped();
    }
    if (target === Array) {
      return {
        kind: "array",
        items: unreadable(
          "Array element type is erased at runtime; declare @Type(() => X).",
        ),
      };
    }
    if (target === Object) {
      return unreadable(
        "'Object' carries no readable shape; any JSON value is accepted.",
      );
    }
    return { kind: "ref", ref: this.declare(target as NewableFunction) };
  }

  private declare(target: NewableFunction): string {
    const existing = this.keys.get(target);
    if (existing !== undefined) {
      return existing;
    }
    const key = target.name;
    this.keys.set(target, key);
    this.types[key] = { name: target.name, members: [] };
    this.types[key] = { name: target.name, members: this.members(target) };
    return key;
  }

  private members(target: NewableFunction): Member[] {
    const validation = groupValidators(target);
    if (validation.size === 0) {
      this.options.report?.({
        code: "unreadable_shape",
        message: `'${target.name}' carries no class-validator metadata; its shape cannot be read. Decorate its properties, or declare options.schema.typeShape.`,
      });
      return [];
    }
    return [...validation].map(([property, entries]) =>
      this.member(target, property, entries),
    );
  }

  private member(
    target: NewableFunction,
    property: string,
    entries: readonly ValidationEntry[],
  ): Member {
    const nested = nestedType(target, property);
    const reflected = Reflect.getMetadata(
      "design:type",
      target.prototype as object,
      property,
    ) as unknown;

    const inner =
      nested !== undefined
        ? this.node(nested, property)
        : this.fromValidators(entries, reflected, property);

    const each = entries.some((entry) => entry.each === true);
    const type: TypeNode = each ? { kind: "array", items: inner } : inner;
    const constraints = constraintsOf(entries);

    return {
      name: property,
      type,
      required: !entries.some(
        (entry) => entry.type === "conditionalValidation",
      ),
      readOnly: false,
      constructorBound: false,
      ...(constraints === undefined ? {} : { constraints }),
    };
  }

  private fromValidators(
    entries: readonly ValidationEntry[],
    reflected: unknown,
    property: string,
  ): TypeNode {
    for (const entry of entries) {
      const mapped = validatorScalar(entry.name);
      if (mapped !== undefined) {
        return mapped;
      }
    }
    if (reflected !== undefined && reflected !== Array) {
      return this.node(reflected, property);
    }
    return unreadable(
      `Member '${property}' has no readable type; add a class-validator type decorator or @Type(() => X).`,
    );
  }
}

function validatorScalar(name: string | undefined): TypeNode | undefined {
  switch (name) {
    case "isString":
    case "isEmail":
    case "isUrl":
      return scalar("string");
    case "isInt":
      return scalar("integer");
    case "isNumber":
      return scalar("number");
    case "isBoolean":
      return scalar("boolean");
    case "isUuid":
      return scalar("string", "uuid");
    case "isDate":
    case "isDateString":
      return scalar("string", "date-time");
    default:
      return undefined;
  }
}

function constraintsOf(
  entries: readonly ValidationEntry[],
): Constraints | undefined {
  const found: Record<string, unknown> = {};
  const number = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;

  for (const entry of entries) {
    const first = entry.constraints?.[0];
    switch (entry.name) {
      case "minLength":
      case "arrayMinSize":
        found["minSize"] = number(first) ?? found["minSize"];
        break;
      case "maxLength":
      case "arrayMaxSize":
        found["maxSize"] = number(first) ?? found["maxSize"];
        break;
      case "min":
        found["minimum"] = number(first) ?? found["minimum"];
        break;
      case "max":
        found["maximum"] = number(first) ?? found["maximum"];
        break;
      case "matches":
        if (first instanceof RegExp) {
          found["pattern"] = first.source;
        }
        break;
      case "isEmail":
        found["format"] = "email";
        break;
      case "isUrl":
        found["format"] = "uri";
        break;
      default:
        break;
    }
  }
  for (const key of Object.keys(found)) {
    if (found[key] === undefined) {
      delete found[key];
    }
  }
  return Object.keys(found).length === 0 ? undefined : (found as Constraints);
}

interface MetadataStorage {
  getTargetValidationMetadatas(
    target: NewableFunction,
    targetSchema: string,
    always: boolean,
    strictGroups: boolean,
  ): unknown[];
}

interface TransformStorage {
  findTypeMetadata(target: NewableFunction, property: string): unknown;
}

let validators: MetadataStorage | null | undefined;
let transforms: TransformStorage | null | undefined;

function groupValidators(
  target: NewableFunction,
): Map<string, ValidationEntry[]> {
  const grouped = new Map<string, ValidationEntry[]>();
  if (validators === undefined) {
    try {
      validators = (
        load("class-validator") as {
          getMetadataStorage: () => MetadataStorage;
        }
      ).getMetadataStorage();
    } catch {
      validators = null;
    }
  }
  if (validators === null) {
    return grouped;
  }
  const entries = validators.getTargetValidationMetadatas(
    target,
    target.name,
    true,
    false,
  ) as ValidationEntry[];
  for (const entry of entries) {
    const list = grouped.get(entry.propertyName);
    if (list === undefined) {
      grouped.set(entry.propertyName, [entry]);
    } else {
      list.push(entry);
    }
  }
  return grouped;
}

function nestedType(
  target: NewableFunction,
  property: string,
): unknown | undefined {
  if (transforms === undefined) {
    try {
      transforms = (
        load("class-transformer/cjs/storage") as {
          defaultMetadataStorage: TransformStorage;
        }
      ).defaultMetadataStorage;
    } catch {
      transforms = null;
    }
  }
  if (transforms === null) {
    return undefined;
  }
  const metadata = transforms.findTypeMetadata(target, property) as
    { typeFunction?: () => unknown } | undefined;
  return metadata?.typeFunction?.();
}
