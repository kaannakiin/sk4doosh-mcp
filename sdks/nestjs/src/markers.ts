const LIAISO_REQUEST = Symbol("liaiso.request");
const LIAISO_PROBE = Symbol("liaiso.probe");
const LIAISO_SHORT_CIRCUIT = Symbol("liaiso.probe.short-circuited");

type Marked = Record<symbol, boolean | undefined>;

export function markSyntheticRequest(request: object, probe: boolean): void {
  const marked = request as Marked;
  marked[LIAISO_REQUEST] = true;
  if (probe) {
    marked[LIAISO_PROBE] = true;
  }
}

export function markShortCircuited(request: object): void {
  (request as Marked)[LIAISO_SHORT_CIRCUIT] = true;
}

export function isLiaisoRequest(request: unknown): boolean {
  return reads(request, LIAISO_REQUEST);
}

export function isLiaisoProbe(request: unknown): boolean {
  return reads(request, LIAISO_PROBE);
}

export function wasShortCircuited(request: unknown): boolean {
  return reads(request, LIAISO_SHORT_CIRCUIT);
}

function reads(request: unknown, key: symbol): boolean {
  return (
    typeof request === "object" &&
    request !== null &&
    (request as Marked)[key] === true
  );
}
