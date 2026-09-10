import type { ApiError, ValidationIssue } from "@chat/contracts/http/error";
import {
  HttpException,
  HttpStatus,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from "@nestjs/common";
import type { ZodType } from "zod";
import type { $ZodIssue } from "zod/v4/core";

import { I18nService } from "../i18n/i18n.service.ts";

const TRANSLATED_CODES = new Set([
  "invalid_type",
  "invalid_value",
  "too_big",
  "too_small",
]);

function isZodSchema(schema: unknown): schema is ZodType {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "safeParse" in schema &&
    typeof (schema as ZodType).safeParse === "function"
  );
}

function limitOf(issue: $ZodIssue): number | bigint | undefined {
  if ("minimum" in issue) {
    return issue.minimum;
  }

  return "maximum" in issue ? issue.maximum : undefined;
}

/**
 * Validates against the Standard Schema attached by `@Body({ schema })`.
 *
 * Guard: it reads the schema through `metadata.schema` and re-parses with Zod's
 * own `safeParse` rather than the Standard Schema `validate`, because
 * `StandardSchemaV1.Issue` carries only `message` and `path` — the `code` and
 * `minimum`/`maximum` this filter needs to look up a localized message would be
 * lost, and the English default message would leak into the response.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly i18n: I18nService) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!isZodSchema(metadata.schema)) {
      return value;
    }

    const result = metadata.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    const body: ApiError = {
      code: "validation_failed",
      message: this.i18n.t("validation:failed"),
      issues: result.error.issues.map((issue) => this.render(issue)),
    };

    throw new HttpException(body, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  private render(issue: $ZodIssue): ValidationIssue {
    const name = issue.path.at(-1);
    const fieldKey = typeof name === "string" ? name : "root";
    const code = TRANSLATED_CODES.has(issue.code) ? issue.code : "fallback";

    return {
      path: issue.path.map((segment) =>
        typeof segment === "symbol" ? segment.toString() : segment,
      ),
      code: issue.code,
      message: this.i18n.t(`validation:issues.${code}`, {
        field: this.i18n.t(`validation:fields.${fieldKey}`, {
          defaultValue: fieldKey,
        }),
        limit: limitOf(issue),
      }),
    };
  }
}
