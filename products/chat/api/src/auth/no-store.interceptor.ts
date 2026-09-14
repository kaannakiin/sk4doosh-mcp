import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Response } from "express";
import type { Observable } from "rxjs";

@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader("cache-control", "no-store");

    return next.handle();
  }
}
