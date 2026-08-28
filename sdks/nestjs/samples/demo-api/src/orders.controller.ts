import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtGuard, OrdersReadGuard, type AuthedRequest } from "./auth.js";

@Controller()
export class OrdersController {
  private readonly notes = new Map<number, string[]>();

  @Get("ping")
  ping() {
    return { pong: true };
  }

  @Get("me")
  @UseGuards(JwtGuard)
  me(@Req() request: AuthedRequest) {
    return { sub: request.user?.sub ?? null, scope: request.user?.scope ?? "" };
  }

  @Get("orders/:id")
  @UseGuards(JwtGuard, OrdersReadGuard)
  order(@Param("id", ParseIntPipe) id: number) {
    return { id, status: "shipped", notes: this.notes.get(id) ?? [] };
  }

  @Post("orders/:id/notes")
  @UseGuards(JwtGuard, OrdersReadGuard)
  addNote(
    @Param("id", ParseIntPipe) id: number,
    @Query("notify") notify: string | undefined,
    @Body() body: { text?: string },
  ) {
    if (typeof body?.text !== "string" || body.text.length === 0) {
      throw new BadRequestException("text is required");
    }
    const list = this.notes.get(id) ?? [];
    list.push(body.text);
    this.notes.set(id, list);
    return { id, notes: list, notified: notify === "true" };
  }
}
