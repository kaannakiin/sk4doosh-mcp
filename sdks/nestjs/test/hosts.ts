import "reflect-metadata";
import type { IncomingHttpHeaders } from "node:http";
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import jwt from "jsonwebtoken";
import {
  SkMcpDispatcher,
  SkMcpModule,
  type OuterRequest,
  type SkMcpOptions,
} from "../src/index.js";

const secret = "sk-mcp-test-secret-0123456789abcdef";

export function mintToken(
  user: string,
  scopes: string[],
  expiresInSeconds = 3600,
): string {
  return jwt.sign({ sub: user, scope: scopes.join(" ") }, secret, {
    expiresIn: expiresInSeconds,
  });
}

export interface AuthedRequest {
  headers: IncomingHttpHeaders;
  protocol?: string;
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
        secret,
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

export const hits = { admin: 0 };

@Controller()
export class ProbeController {
  @Get("ping")
  ping() {
    return { pong: true };
  }

  @Get("me")
  @UseGuards(JwtGuard)
  me(@Req() request: AuthedRequest) {
    return { sub: request.user?.sub ?? null };
  }

  @Get("orders/:id")
  @UseGuards(JwtGuard, OrdersReadGuard)
  order(@Param("id") id: string) {
    return { order: id };
  }

  @Get("echo-headers")
  echoHeaders(@Req() request: AuthedRequest) {
    return {
      authorization: request.headers.authorization ?? null,
      cookie: request.headers.cookie ?? null,
      csrf: request.headers["x-csrf-token"] ?? null,
      hasAuthorization: "authorization" in request.headers,
    };
  }

  @Get("admin")
  admin() {
    hits.admin += 1;
    return { admin: true };
  }

  @Get("files/:name")
  file(@Param("name") name: string) {
    return { name };
  }

  @Get("items")
  items(@Query() query: Record<string, unknown>) {
    return query;
  }

  @Post("orders/:id/notes")
  note(
    @Param("id") id: string,
    @Query("notify") notify: string | undefined,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthedRequest,
  ) {
    return {
      id,
      notify: notify ?? null,
      body,
      contentType: request.headers["content-type"] ?? null,
    };
  }

  @Get("meta")
  meta(@Req() request: AuthedRequest) {
    return {
      protocol: request.protocol ?? null,
      host: request.headers.host ?? null,
      accept: request.headers.accept ?? null,
      userAgent: request.headers["user-agent"] ?? null,
      traceparent: request.headers.traceparent ?? null,
      acceptEncoding: request.headers["accept-encoding"] ?? null,
    };
  }

  @Get("tenant")
  tenant(@Req() request: AuthedRequest) {
    return {
      tenant: (request.headers.host ?? "").startsWith("tenant-a")
        ? "A"
        : "other",
    };
  }
}

export interface TestApp {
  app: INestApplication;
  dispatcher: SkMcpDispatcher;
  close(): Promise<void>;
}

export async function createApp(
  configure?: (options: SkMcpOptions) => void,
): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [SkMcpModule.forRoot(configure)],
    controllers: [ProbeController],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return {
    app,
    dispatcher: app.get(SkMcpDispatcher),
    close: () => app.close(),
  };
}

export function outer(
  headers: Record<string, string | string[]> = {},
  protocol?: string,
): OuterRequest {
  return protocol === undefined ? { headers } : { headers, protocol };
}
