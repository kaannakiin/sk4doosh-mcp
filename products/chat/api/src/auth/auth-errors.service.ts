import type { ApiError } from "@chat/contracts/http/error";
import { HttpException, Injectable, type HttpStatus } from "@nestjs/common";

import { I18nService } from "../i18n/i18n.service.ts";

export type AuthErrorCode =
  | "account_exists"
  | "invalid_credentials"
  | "verification_required"
  | "invalid_or_expired_challenge"
  | "unauthorized"
  | "session_expired"
  | "oauth_provider_unavailable"
  | "oauth_state_invalid"
  | "oauth_link_required"
  | "oauth_account_conflict"
  | "too_many_requests";

@Injectable()
export class AuthErrorsService {
  constructor(private readonly i18n: I18nService) {}

  fail(code: AuthErrorCode, status: HttpStatus): never {
    const body: ApiError = {
      code,
      message: this.i18n.t(`http:${code}`),
    };
    throw new HttpException(body, status);
  }
}
