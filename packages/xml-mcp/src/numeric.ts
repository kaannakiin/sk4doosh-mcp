const lexical = /^(-?)(\d*)(?:\.(\d*))?$/u;
function trimXmlSpace(value: string): string {
  let start = 0;
  let end = value.length;

  const isXmlSpace = (code: number): boolean =>
    code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a;

  while (start < end && isXmlSpace(value.charCodeAt(start))) start++;
  while (end > start && isXmlSpace(value.charCodeAt(end - 1))) end--;

  return value.slice(start, end);
}

const mantissaCeiling = 9007199254740992n;

export class NumericPrecisionError extends Error {
  constructor(readonly text: string) {
    super("numeric_precision");
  }
}

export interface NumericValue {
  readonly value: number;
  readonly rounded: boolean;
}

/**
 * XPath 1.0 has no exponent form, so the engine's lenient strtod is not the
 * contract: "1e400" is not a number here. A decimal M/10^f is exact in binary64
 * only when 5^f divides M; when M itself outruns the 53-bit mantissa the digits
 * are gone rather than rounded, and that is the loud case.
 */
export function toNumber(raw: string): NumericValue | undefined {
  const text = trimXmlSpace(raw);
  const parts = lexical.exec(text);
  if (parts === null) return undefined;
  const [, sign, whole = "", fraction] = parts;
  if (whole === "" && (fraction === undefined || fraction === "")) {
    return undefined;
  }
  const digits = whole + (fraction ?? "");
  const scale = BigInt(fraction?.length ?? 0);
  const mantissa = BigInt(digits);
  const power = 5n ** scale;
  if (mantissa > mantissaCeiling * power) {
    throw new NumericPrecisionError(text);
  }
  const value = Number(text);
  return {
    value: sign === "-" && value === 0 ? -0 : value,
    rounded: mantissa % power !== 0n,
  };
}

export interface SumState {
  total: number;
  compensation: number;
}

export function newSum(): SumState {
  return { total: 0, compensation: 0 };
}

export function addTo(state: SumState, value: number): void {
  const next = state.total + value;
  state.compensation +=
    Math.abs(state.total) >= Math.abs(value)
      ? state.total - next + value
      : value - next + state.total;
  state.total = next;
}

export function sumOf(state: SumState): number {
  return state.total + state.compensation;
}
