import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

import type { AppConfig } from "../config/configuration.ts";
import { AuthErrorsService } from "./auth-errors.service.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class AuthOriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly errors: AuthErrorsService,
  ) {
    this.allowedOrigin = new URL(
      config.get("corsOrigin", { infer: true }),
    ).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }
    const origin = request.get("origin");
    if (origin === undefined || origin !== this.allowedOrigin) {
      this.errors.fail("unauthorized", HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
