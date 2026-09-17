import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

import { AuthCookieService } from "./auth-cookie.service.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import type { RequestWithAuth } from "./request-auth.ts";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly cookies: AuthCookieService,
    private readonly sessions: AuthSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    request.auth = await this.sessions.authenticate(
      this.cookies.access(request),
    );

    return true;
  }
}
