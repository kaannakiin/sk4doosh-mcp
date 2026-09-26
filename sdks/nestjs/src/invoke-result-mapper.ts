import { Inject, Injectable } from "@nestjs/common";
import { mapInvokeResult, type InvokeResult } from "@liaiso/core";
import type { DispatchResult } from "./dispatcher.js";
import { LIAISO_OPTIONS, LiaisoOptions } from "./options.js";

/** The names a reported field may be canonicalised against. */
export interface FieldVocabulary {
  readonly fieldAliases?: Readonly<Record<string, string>>;
  readonly hiddenFields?: readonly string[];
}

export interface InvokeResultMapper {
  map(
    result: DispatchResult,
    knownFields: readonly string[],
    vocabulary?: FieldVocabulary,
  ): InvokeResult;
}

@Injectable()
export class DefaultInvokeResultMapper implements InvokeResultMapper {
  constructor(
    @Inject(LIAISO_OPTIONS) private readonly options: LiaisoOptions,
  ) {}

  map(
    result: DispatchResult,
    knownFields: readonly string[],
    vocabulary?: FieldVocabulary,
  ): InvokeResult {
    return mapInvokeResult(
      {
        status: result.status,
        contentType: result.contentType,
        headers: result.headers,
        body: result.body,
      },
      {
        recognizers: this.options.errors.recognizers,
        knownFields,
        ...(vocabulary?.fieldAliases === undefined
          ? {}
          : { fieldAliases: vocabulary.fieldAliases }),
        ...(vocabulary?.hiddenFields === undefined
          ? {}
          : { hiddenFields: vocabulary.hiddenFields }),
      },
    );
  }
}
