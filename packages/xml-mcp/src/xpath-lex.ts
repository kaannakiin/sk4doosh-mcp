const nameStart = /[A-Za-z_]/u;
const namePart = /[A-Za-z0-9_.-]/u;

const operatorWords = new Set(["and", "or", "div", "mod"]);

export interface Lexed {
  readonly prefixes: readonly string[];
  readonly unprefixedNameTests: readonly string[];
  readonly functions: readonly string[];
  readonly axes: readonly string[];
}

function readName(expression: string, from: number): number {
  let index = from;
  while (index < expression.length) {
    const character = expression[index];
    if (character === undefined || !namePart.test(character)) break;
    index += 1;
  }
  return index;
}

function skipSpace(expression: string, from: number): number {
  let index = from;
  while (index < expression.length && /\s/u.test(expression[index] ?? "")) {
    index += 1;
  }
  return index;
}

/**
 * Inspection only: the expression is handed to the engine exactly as written.
 * This exists because the engine reports a compile failure as a fixed template
 * with no position or reason, so a usable diagnosis has to come from here.
 */
export function lex(expression: string): Lexed {
  const prefixes = new Set<string>();
  const unprefixed = new Set<string>();
  const functions = new Set<string>();
  const axes = new Set<string>();

  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (character === undefined) break;
    if (character === "'" || character === '"') {
      const close = expression.indexOf(character, index + 1);
      index = close === -1 ? expression.length : close + 1;
      continue;
    }
    if (!nameStart.test(character)) {
      index += 1;
      continue;
    }

    const localEnd = readName(expression, index + 1);
    let name = expression.slice(index, localEnd);
    let prefix: string | undefined;
    let cursor = localEnd;

    if (
      expression[cursor] === ":" &&
      expression[cursor + 1] !== ":" &&
      nameStart.test(expression[cursor + 1] ?? "")
    ) {
      const suffixEnd = readName(expression, cursor + 2);
      prefix = name;
      name = expression.slice(cursor + 1, suffixEnd);
      cursor = suffixEnd;
    }

    const after = skipSpace(expression, cursor);
    if (expression[after] === "(") {
      functions.add(prefix === undefined ? name : `${prefix}:${name}`);
      if (prefix !== undefined) prefixes.add(prefix);
      index = after + 1;
      continue;
    }
    if (expression[after] === ":" && expression[after + 1] === ":") {
      if (prefix === undefined) axes.add(name);
      index = after + 2;
      continue;
    }

    if (prefix === undefined) {
      if (!operatorWords.has(name)) unprefixed.add(name);
    } else {
      prefixes.add(prefix);
    }
    index = cursor;
  }

  return {
    prefixes: [...prefixes],
    unprefixedNameTests: [...unprefixed],
    functions: [...functions],
    axes: [...axes],
  };
}
