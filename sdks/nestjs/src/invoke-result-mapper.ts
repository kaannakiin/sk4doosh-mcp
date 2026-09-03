import { Inject, Injectable } from "@nestjs/common";
import { mapInvokeResult, type InvokeResult } from "@sk-mcp/core";
import type { DispatchResult } from "./dispatcher.js";
import { SK_MCP_OPTIONS, SkMcpOptions } from "./options.js";

export interface InvokeResultMapper {
  map(result: DispatchResult, knownFields: readonly string[]): InvokeResult;
}

@Injectable()
export class DefaultInvokeResultMapper implements InvokeResultMapper {
  constructor(@Inject(SK_MCP_OPTIONS) private readonly options: SkMcpOptions) {}

  map(result: DispatchResult, knownFields: readonly string[]): InvokeResult {
    return mapInvokeResult(
      {
        status: result.status,
        contentType: result.contentType,
        headers: result.headers,
        body: result.body,
      },
      { recognizers: this.options.errors.recognizers, knownFields },
    );
  }
}
