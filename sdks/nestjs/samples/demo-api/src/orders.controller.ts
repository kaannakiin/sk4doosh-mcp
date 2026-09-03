import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsInt, IsNotEmpty, IsString, Max, Min } from "class-validator";
import { JwtGuard, OrdersReadGuard, type AuthedRequest } from "./auth.js";

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  item!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

export class AddNoteDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}

interface Order {
  id: number;
  item: string;
  quantity: number;
  status: string;
  notes: string[];
}

@Controller()
export class OrdersController {
  private readonly orders = new Map<number, Order>();
  private nextId = 1;

  @Get("ping")
  ping() {
    return { pong: true };
  }

  @Get("me")
  @UseGuards(JwtGuard)
  me(@Req() request: AuthedRequest) {
    return { sub: request.user?.sub ?? null, scope: request.user?.scope ?? "" };
  }

  @Post("orders")
  @UseGuards(JwtGuard, OrdersReadGuard)
  createOrder(@Body() body: CreateOrderDto): Order {
    const order: Order = {
      id: this.nextId++,
      item: body.item,
      quantity: body.quantity,
      status: "pending",
      notes: [],
    };
    this.orders.set(order.id, order);
    return order;
  }

  @Get("orders/:id")
  @UseGuards(JwtGuard, OrdersReadGuard)
  order(@Param("id", ParseIntPipe) id: number): Order {
    const order = this.orders.get(id);
    if (order === undefined) {
      throw new NotFoundException(`order ${id} does not exist`);
    }
    return order;
  }

  @Post("orders/:id/notes")
  @UseGuards(JwtGuard, OrdersReadGuard)
  addNote(
    @Param("id", ParseIntPipe) id: number,
    @Query("notify") notify: string | undefined,
    @Body() body: AddNoteDto,
  ) {
    const order = this.orders.get(id);
    if (order === undefined) {
      throw new NotFoundException(`order ${id} does not exist`);
    }
    order.notes.push(body.text);
    return { id, notes: order.notes, notified: notify === "true" };
  }
}
