export type LeakRule =
  | "stack_frame"
  | "exception_type"
  | "file_path"
  | "connection_string"
  | "credential"
  | "too_long";

export interface LeakVerdict {
  readonly normalized: string;
  readonly rule: LeakRule | null;
}

interface LeakPattern {
  readonly rule: LeakRule;
  readonly pattern: RegExp;
}

const maxForwardableLength = 1000;

const leakPatterns: readonly LeakPattern[] = [
  {
    rule: "stack_frame",
    pattern: /(^|\s)at\s+[\w$.<>]+[\s.]*\(/,
  },
  {
    rule: "stack_frame",
    pattern: /(^|\s)at\s+\S+:\d+:\d+\)?/,
  },
  {
    rule: "stack_frame",
    pattern: /Traceback \(most recent call last\):/,
  },
  {
    rule: "exception_type",
    pattern: /\b\w*Exception\b/,
  },
  {
    rule: "exception_type",
    pattern:
      /\b(TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError)\b/,
  },
  {
    rule: "file_path",
    pattern: /[A-Za-z]:\\[^\s"]+/,
  },
  {
    rule: "file_path",
    pattern: /\\\\[^\s\\]+\\[^\s"]+/,
  },
  {
    rule: "file_path",
    pattern: /\/(?:Users|home|var|usr|opt|srv|app|src|etc|tmp)\/[^\s"]*/,
  },
  {
    rule: "file_path",
    pattern:
      /\.(?:cs|ts|tsx|js|jsx|py|java|rb|go|php|cpp|c|h|kt|swift):(?:line )?\d+/i,
  },
  {
    rule: "connection_string",
    pattern:
      /\b(?:Server|Data Source|Password|User Id|Uid|Pwd|Initial Catalog)\s*=\s*[^;]+;/i,
  },
  {
    rule: "connection_string",
    pattern:
      /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|mssql):\/\//i,
  },
  {
    rule: "connection_string",
    pattern: /:\/\/[^/\s:@]+:[^/\s:@]+@/,
  },
  {
    rule: "credential",
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*/i,
  },
  {
    rule: "credential",
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function inspect(value: string): LeakVerdict {
  const normalized = normalizeWhitespace(value);
  for (const { rule, pattern } of leakPatterns) {
    if (pattern.test(normalized)) {
      return { normalized, rule };
    }
  }
  if (normalized.length > maxForwardableLength) {
    return { normalized, rule: "too_long" };
  }
  return { normalized, rule: null };
}

export function forwardable(value: string): string | undefined {
  const verdict = inspect(value);
  return verdict.rule === null ? verdict.normalized : undefined;
}
