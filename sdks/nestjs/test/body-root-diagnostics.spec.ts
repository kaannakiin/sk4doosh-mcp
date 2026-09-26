import "reflect-metadata";
import { Body, Controller, Param, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { IsString } from "class-validator";
import { beforeAll, describe, expect, it } from "vitest";
import { LiaisoCatalog } from "../src/catalog.js";
import { McpTool } from "../src/decorators.js";
import { LiaisoModule } from "../src/liaiso.module.js";

class NoteDto {
  @IsString()
  text!: string;
}

class IdentifiedNoteDto {
  @IsString()
  id!: string;

  @IsString()
  text!: string;
}

@Controller("diagnosed")
@McpTool()
class DiagnosedController {
  @Post("flat/:id")
  flat(@Param("id") _id: string, @Body() _note: NoteDto): string {
    return "ok";
  }

  @Post("optional")
  @McpTool({ bodyRequired: false })
  optional(@Body() _note?: NoteDto): string {
    return "ok";
  }

  @Post("scalars")
  scalars(@Body() _values: number[]): string {
    return "ok";
  }

  @Post("colliding/:id")
  colliding(
    @Param("id") _id: string,
    @Body() _note: IdentifiedNoteDto,
  ): string {
    return "ok";
  }
}

describe("body root diagnostics", () => {
  let catalog: LiaisoCatalog;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LiaisoModule.forRoot()],
      controllers: [DiagnosedController],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    catalog = app.get(LiaisoCatalog);
  });

  const codesFor = (handler: string): string[] =>
    catalog.current.diagnostics
      .filter((diagnostic) =>
        diagnostic.message.includes(`/diagnosed/${handler}`),
      )
      .map((diagnostic) => diagnostic.code);

  it("B1: a flattenable body reports nothing", () => {
    expect(codesFor("flat")).toEqual([]);
  });

  it("B2: an optional body is reported, which NestJS never did before", () => {
    expect(codesFor("optional")).toEqual(["optional_body_argument"]);
  });

  it("B3: a non-object body root is reported", () => {
    expect(codesFor("scalars")).toEqual(["synthetic_body_argument"]);
  });

  it("B4: a body field colliding with a parameter is reported", () => {
    expect(codesFor("colliding")).toEqual(["body_field_collision"]);
  });

  it("B5: the colliding endpoint survives, with the body under the root argument", () => {
    const entry = catalog.current.entries.find(
      (candidate) => candidate.descriptor.route === "/diagnosed/colliding/{id}",
    );
    expect(entry).toBeDefined();
    expect(Object.keys(entry?.tool.inputSchema.properties ?? {})).toEqual([
      "id",
      "body",
    ]);
  });

  it("B6: none of these are fatal", () => {
    expect(catalog.current.fatal).toEqual([]);
  });
});
