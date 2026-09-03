import "reflect-metadata";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IsNotEmpty, IsString } from "class-validator";
import type { Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRequestTemplate,
  extensionTokens,
  isMappedError,
  SkMcpDispatcher,
  SkMcpModule,
  type ExtensionOverrides,
  type InvokeResult,
  type InvokeResultMapper,
  type MappedError,
  type Recognizer,
  type SkMcpOptions,
} from "../src/index.js";

const validateTemplate = createRequestTemplate({
  method: "POST",
  route: "/validate",
  parameters: [],
  bodyProperties: ["name"],
});

class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

@Controller()
class ErrorMappingProbeController {
  @Get("rate-limited")
  rateLimited(@Res({ passthrough: true }) res: Response) {
    res.set("Retry-After", "30");
    res.status(429);
    return { message: "Too many requests, slow down." };
  }

  @Post("validate")
  @UsePipes(new ValidationPipe())
  validate(@Body() body: CreateItemDto) {
    return { ok: true, name: body.name };
  }

  @Post("validate-named")
  validateNamed(): never {
    throw new BadRequestException({
      errors: { name: "name must not be empty" },
    });
  }

  @Get("secret")
  secret(): never {
    throw new UnauthorizedException(
      "token verification failed: signature invalid for kid 7f3a-...",
    );
  }

  @Get("boom")
  boom(): never {
    throw new Error(
      "unexpected failure while charging order #482 (at OrderService.charge (/Users/dev/app/src/order.service.ts:42:11))",
    );
  }

  @Get("boom-with-correlation")
  boomWithCorrelation(@Res({ passthrough: true }) res: Response): never {
    res.set("X-Correlation-Id", "corr-482-xyz");
    throw new Error("db timeout while charging order #482");
  }

  @Post("custom-envelope")
  customEnvelope(@Res({ passthrough: true }) res: Response) {
    res.status(400);
    return { message: "clean message from the backend" };
  }

  @Get("items/:id")
  item(@Param("id", ParseIntPipe) id: number) {
    return { id };
  }

  @Get("greeting")
  greeting() {
    return { hello: "world" };
  }

  @Get("greeting-text")
  greetingText(@Res({ passthrough: true }) res: Response) {
    res.type("text/plain");
    return "pong";
  }
}

interface TestApp {
  app: INestApplication;
  dispatcher: SkMcpDispatcher;
  mapper: InvokeResultMapper;
  close(): Promise<void>;
}

async function createApp(
  configure?: (options: SkMcpOptions) => void,
  overrides?: ExtensionOverrides,
): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [SkMcpModule.forRoot(configure, overrides)],
    controllers: [ErrorMappingProbeController],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return {
    app,
    dispatcher: app.get(SkMcpDispatcher),
    mapper: app.get<InvokeResultMapper>(extensionTokens.invokeResultMapper),
    close: () => app.close(),
  };
}

let current: TestApp | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
});

function assertMappedError(
  outcome: InvokeResult,
): asserts outcome is MappedError {
  expect(isMappedError(outcome)).toBe(true);
}

describe("Nest error mapping", () => {
  it("E1: a 429 carries retryAfterSeconds and the response's contentType", async () => {
    current = await createApp();
    const result = await current.dispatcher.dispatch("GET", "/rate-limited");
    expect(result.status).toBe(429);
    expect(result.contentType).toContain("application/json");

    const outcome = current.mapper.map(result, []);
    assertMappedError(outcome);
    expect(outcome.error).toBe("rate_limited");
    expect(outcome.retryable).toBe(true);
    expect(outcome.retryAfterSeconds).toBe(30);
  });

  it("E2: Nest's default ValidationPipe array becomes unnamed field errors", async () => {
    current = await createApp();
    const result = await current.dispatcher.dispatch(validateTemplate, {
      name: "",
    });
    expect(result.status).toBe(400);

    const outcome = current.mapper.map(result, ["name"]);
    assertMappedError(outcome);
    expect(outcome.error).toBe("validation_failed");
    expect(outcome.fields?.length).toBeGreaterThan(0);
    for (const field of outcome.fields ?? []) {
      expect(field.name).toBeUndefined();
    }
  });

  it("E3: an exceptionFactory-style errors map becomes named field errors", async () => {
    current = await createApp();
    const result = await current.dispatcher.dispatch("POST", "/validate-named");
    const outcome = current.mapper.map(result, ["name"]);
    assertMappedError(outcome);
    expect(outcome.error).toBe("validation_failed");
    expect(outcome.fields).toEqual([
      { name: "name", message: "name must not be empty" },
    ]);
  });

  it("E4: a 401 body is never forwarded, even when it names a real credential detail", async () => {
    current = await createApp();
    const result = await current.dispatcher.dispatch("GET", "/secret");
    expect(result.status).toBe(401);
    expect(result.body).toContain("token verification failed");

    const outcome = current.mapper.map(result, []);
    assertMappedError(outcome);
    expect(outcome.error).toBe("unauthenticated");
    expect(outcome.message).not.toContain("token verification failed");
    expect(outcome.fields).toBeUndefined();
  });

  it("E5: a 500 body is always withheld; a correlation header still becomes reference", async () => {
    current = await createApp();

    const plain = await current.dispatcher.dispatch("GET", "/boom");
    const plainOutcome = current.mapper.map(plain, []);
    assertMappedError(plainOutcome);
    expect(plainOutcome.error).toBe("backend_error");
    expect(plainOutcome.message).not.toContain("OrderService");
    expect(plainOutcome.reference).toBeUndefined();

    const withCorrelation = await current.dispatcher.dispatch(
      "GET",
      "/boom-with-correlation",
    );
    const outcome = current.mapper.map(withCorrelation, []);
    assertMappedError(outcome);
    expect(outcome.message).not.toContain("db timeout");
    expect(outcome.reference).toBe("corr-482-xyz");
  });

  it("E6: a host recognizer runs before the built-ins, and its output is still leak-filtered", async () => {
    const leaky: Recognizer = (parsed) => {
      if (
        parsed.kind !== "json" ||
        typeof parsed.value !== "object" ||
        parsed.value === null
      ) {
        return null;
      }
      const record = parsed.value as Record<string, unknown>;
      if (typeof record["message"] !== "string") {
        return null;
      }
      return {
        message: "at Object.<anonymous> (/Users/dev/app/src/handler.js:10:4)",
      };
    };
    current = await createApp((options) => {
      options.errors.recognize(leaky);
    });

    const result = await current.dispatcher.dispatch(
      "POST",
      "/custom-envelope",
    );
    const outcome = current.mapper.map(result, []);
    assertMappedError(outcome);
    expect(outcome.message).not.toContain("handler.js");
    expect(outcome.message).not.toBe("clean message from the backend");
  });

  it("E7: overrides.invokeResultMapper replaces the default mapper entirely", async () => {
    const fake: InvokeResultMapper = {
      map: () => ({ status: 200, body: "faked-by-override" }),
    };
    current = await createApp(undefined, {
      invokeResultMapper: { useValue: fake },
    });
    const resolved = current.app.get<InvokeResultMapper>(
      extensionTokens.invokeResultMapper,
    );
    expect(resolved).toBe(fake);
    expect(resolved.map({ status: 500, body: "", headers: {} }, [])).toEqual({
      status: 200,
      body: "faked-by-override",
    });
  });

  it("E8: ParseIntPipe's plain-string validation message maps to bad_request, forwarded", async () => {
    current = await createApp();
    const result = await current.dispatcher.dispatch(
      "GET",
      "/items/not-a-number",
    );
    expect(result.status).toBe(400);

    const outcome = current.mapper.map(result, []);
    assertMappedError(outcome);
    expect(outcome.error).toBe("bad_request");
    expect(outcome.fields).toBeUndefined();
    expect(outcome.message).toContain("numeric string");
  });

  it("E9: success responses parse JSON bodies and carry text bodies with contentType", async () => {
    current = await createApp();

    const json = await current.dispatcher.dispatch("GET", "/greeting");
    const jsonOutcome = current.mapper.map(json, []);
    expect(isMappedError(jsonOutcome)).toBe(false);
    expect(jsonOutcome).toMatchObject({
      status: 200,
      body: { hello: "world" },
    });

    const text = await current.dispatcher.dispatch("GET", "/greeting-text");
    const textOutcome = current.mapper.map(text, []);
    expect(isMappedError(textOutcome)).toBe(false);
    expect(textOutcome).toMatchObject({ status: 200, body: "pong" });
    expect(
      "contentType" in textOutcome ? textOutcome.contentType : undefined,
    ).toContain("text/plain");
  });
});
