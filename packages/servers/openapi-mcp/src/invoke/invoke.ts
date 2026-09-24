import { asciiLower } from "../platform/ascii.js";
import {
  armDeadline,
  compose,
  errorResult,
  isInvokeError,
  knownFields,
  mapInvokeResult,
  narrowingArguments,
  normalizeInvokeArguments,
  notInvocable,
  refuseTimedOutInvoke,
  sdkError,
  SkMcpArgumentError,
  SkMcpDispatchAborted,
  textResult,
  untilAbandoned,
  vocabularyOf,
  writeBody,
  type CatalogEntry,
  type MetaResponse,
} from "@sk-mcp/core";
import type { GatewaySource } from "../catalog/build.js";
import {
  applyCredentials,
  ExchangedTokenMissing,
} from "../credentials/credentials.js";
import {
  HostNotAllowed,
  ResponseTooLarge,
  type BoundedFetch,
} from "../net/fetch.js";

export interface InvokeTarget {
  readonly tool: string;
  readonly method: string;
  readonly route: string;
}

export interface InvokeLimits {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxInlineFileBytes: number;
}

const userAgent = "sk-mcp-openapi/0.0.0";

/**
 * Guard: a `ref` file argument needs a resolver, and this server binds none, so the composer never
 * offers `ref` and this path is unreachable unless a template was built with one.
 */
const noRefResolver = (): never => {
  throw new SkMcpArgumentError(
    "invalid_file_argument",
    "This server accepts file contents inline only; send 'text' or 'base64'.",
  );
};

export async function invokeEntry(
  entry: CatalogEntry<GatewaySource>,
  args: unknown,
  fetcher: BoundedFetch,
  limits: InvokeLimits,
  signal: AbortSignal | undefined,
  exchanged?: string,
): Promise<MetaResponse<InvokeTarget>> {
  const template = entry.template;
  if (template === undefined) {
    return notInvocable(entry.tool.name);
  }
  const target: InvokeTarget = {
    tool: entry.tool.name,
    method: entry.descriptor.method,
    route: entry.descriptor.route,
  };
  const normalized = normalizeInvokeArguments(args);
  let composed: ReturnType<typeof compose>;
  try {
    composed = compose(template, normalized.value, undefined, {
      maxInlineFileBytes: limits.maxInlineFileBytes,
    });
  } catch (error) {
    if (error instanceof SkMcpArgumentError) {
      return errorResult(error.code, error.message);
    }
    throw error;
  }

  const headers: Record<string, string> = {
    accept: "application/json, */*;q=0.5",
    "user-agent": userAgent,
  };
  let cookie: string | undefined;
  for (const [name, value] of Object.entries(composed.headers)) {
    if (asciiLower(name) === "cookie") {
      cookie = value;
    } else {
      headers[asciiLower(name)] = value;
    }
  }
  const slots = { headers, queryPairs: [] as string[], cookie };
  try {
    applyCredentials(entry.credentials, slots, exchanged);
  } catch (error) {
    if (error instanceof SkMcpArgumentError) {
      return errorResult(error.code, error.message);
    }
    if (error instanceof ExchangedTokenMissing) {
      return errorResult(
        "not_invocable",
        `Operation '${entry.tool.name}' acts as the caller, and this session carries no caller token.`,
      );
    }
    throw error;
  }
  if (slots.cookie !== undefined) {
    headers["cookie"] = slots.cookie;
  }
  const extraQuery = slots.queryPairs.join("&");
  const pathAndQuery =
    extraQuery === ""
      ? composed.pathAndQuery
      : `${composed.pathAndQuery}${composed.pathAndQuery.includes("?") ? "&" : "?"}${extraQuery}`;
  const url = new URL(`${entry.baseUrl}${pathAndQuery}`);

  const deadline = armDeadline({
    ...(signal === undefined ? {} : { signal }),
    timeoutMs: limits.timeoutMs,
  });
  try {
    const written =
      composed.body === undefined
        ? undefined
        : await untilAbandoned(
            writeBody(composed.body, noRefResolver),
            deadline.signal,
            deadline.reason,
          );
    if (written !== undefined) {
      headers["content-type"] = written.contentType;
    }
    const response = await fetcher(
      {
        method: template.method,
        url,
        headers,
        ...(written === undefined ? {} : { body: written.bytes }),
      },
      deadline.signal,
      limits.maxResponseBytes,
    );
    const outcome = mapInvokeResult(response, {
      knownFields: knownFields(entry.tool),
      ...vocabularyOf(template),
    });
    return textResult(outcome, isInvokeError(outcome), {
      summaryOf: isInvokeError(outcome) ? outcome : outcome.body,
      narrowing: narrowingArguments(entry.tool.inputSchema),
      target,
    });
  } catch (error) {
    const abandoned = deadline.reason();
    if (
      abandoned === "timeout" ||
      (error instanceof SkMcpDispatchAborted && error.reason === "timeout")
    ) {
      return { payload: refuseTimedOutInvoke(limits.timeoutMs), isError: true };
    }
    if (error instanceof ResponseTooLarge) {
      return {
        payload: sdkError(
          "response_too_large",
          `The backend's answer exceeded ${String(error.limit)} bytes and was not read to the end; narrow the call and retry.`,
        ),
        isError: true,
        narrowing: narrowingArguments(entry.tool.inputSchema),
      };
    }
    if (error instanceof HostNotAllowed) {
      return errorResult(
        "not_invocable",
        `Operation '${entry.tool.name}' targets a host this server may not reach.`,
      );
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}
