import type { IncomingHttpHeaders } from "node:http";
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import jwt from "jsonwebtoken";
import { demoOAuthSecret } from "./oauth-provider.js";

export interface AuthedRequest {
  headers: IncomingHttpHeaders;
  user?: jwt.JwtPayload;
}

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException();
    }
    try {
      request.user = jwt.verify(
        header.slice("Bearer ".length),
        demoOAuthSecret,
      ) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Injectable()
export class OrdersReadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const scopes =
      typeof request.user?.scope === "string"
        ? request.user.scope.split(" ")
        : [];
    if (!scopes.includes("orders.read")) {
      throw new ForbiddenException();
    }
    return true;
  }
}

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const roles =
      typeof request.user?.roles === "string"
        ? request.user.roles.split(",")
        : [];
    if (!roles.includes("admin")) {
      throw new ForbiddenException();
    }
    return true;
  }
}

@Injectable()
export class BusinessHoursGuard implements CanActivate {
  canActivate(): boolean {
    const hour = new Date().getUTCHours();
    if (hour < 6 || hour >= 22) {
      throw new ForbiddenException();
    }
    return true;
  }
}
