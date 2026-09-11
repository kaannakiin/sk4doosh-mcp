import type { ApiError } from "@chat/contracts/http/error";
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { I18nService } from "../i18n/i18n.service.ts";

const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: "bad_request",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "validation_failed",
};

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

/**
 * Guard: normalises every failure into the one envelope the web client parses.
 * Anything that already carries an `ApiError` body — the validation pipe, the
 * attachment store — passes through untouched; everything else, including the
 * `PayloadTooLargeException` Nest raises from a multer byte-limit abort, gets a
 * localized message here instead of Nest's English default.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const existing =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    if (isApiError(existing)) {
      response.status(status).json(existing);

      return;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const code = CODE_BY_STATUS[status] ?? "internal_error";
    const body: ApiError = { code, message: this.i18n.t(`http:${code}`) };
    response.status(status).json(body);
  }
}
