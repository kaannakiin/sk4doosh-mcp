const SK_MCP_REQUEST = Symbol("sk-mcp.request");
const SK_MCP_PROBE = Symbol("sk-mcp.probe");
const SK_MCP_SHORT_CIRCUIT = Symbol("sk-mcp.probe.short-circuited");

type Marked = Record<symbol, boolean | undefined>;

export function markSyntheticRequest(request: object, probe: boolean): void {
  const marked = request as Marked;
  marked[SK_MCP_REQUEST] = true;
  if (probe) {
    marked[SK_MCP_PROBE] = true;
  }
}

export function markShortCircuited(request: object): void {
  (request as Marked)[SK_MCP_SHORT_CIRCUIT] = true;
}

export function isSkMcpRequest(request: unknown): boolean {
  return reads(request, SK_MCP_REQUEST);
}

export function isSkMcpProbe(request: unknown): boolean {
  return reads(request, SK_MCP_PROBE);
}

export function wasShortCircuited(request: unknown): boolean {
  return reads(request, SK_MCP_SHORT_CIRCUIT);
}

function reads(request: unknown, key: symbol): boolean {
  return (
    typeof request === "object" &&
    request !== null &&
    (request as Marked)[key] === true
  );
}
