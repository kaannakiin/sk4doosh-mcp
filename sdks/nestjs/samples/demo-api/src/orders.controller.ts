import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { McpTool } from "@sk-mcp/sdk-nestjs";
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";
import {
  AdminRoleGuard,
  BusinessHoursGuard,
  JwtGuard,
  OrdersReadGuard,
  type AuthedRequest,
} from "./auth.js";

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
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
  readonly id: number;
  readonly item: string;
  readonly quantity: number;
  readonly owner: string;
  readonly notes: string[];
}

@Controller()
@McpTool()
export class OrdersController {
  private readonly orders = new Map<number, Order>();
  private nextId = 1;

  @Get("ping")
  @McpTool({ description: "Health check; requires no identity." })
  ping(): { pong: boolean } {
    return { pong: true };
  }

  @Get("me")
  @UseGuards(JwtGuard)
  @McpTool({ description: "Returns the caller's identity." })
  me(@Req() request: AuthedRequest): { name: unknown } {
    return { name: request.user?.sub };
  }

  @Get("orders/:id")
  @UseGuards(JwtGuard, OrdersReadGuard)
  @McpTool({ description: "Fetches one order by id." })
  getOrder(@Param("id", ParseIntPipe) id: number): Order {
    return this.require(id);
  }

  @Get("orders/:id/receipt")
  @UseGuards(JwtGuard)
  @McpTool({
    description:
      "Returns an order's receipt; only the order's owner may see it.",
  })
  getReceipt(
    @Param("id", ParseIntPipe) id: number,
    @Req() request: AuthedRequest,
  ): { id: number; total: number } {
    const order = this.require(id);
    if (order.owner !== request.user?.sub) {
      throw new ForbiddenException();
    }
    return { id: order.id, total: order.quantity };
  }

  @Get("admin/audit")
  @UseGuards(JwtGuard, AdminRoleGuard)
  @McpTool({ description: "Audit log; admin role only." })
  audit(): { entries: number } {
    return { entries: this.orders.size };
  }

  @Get("reports/summary")
  @UseGuards(JwtGuard, BusinessHoursGuard)
  @McpTool({ description: "Daily summary; closed outside business hours." })
  summary(): { orders: number } {
    return { orders: this.orders.size };
  }

  @Post("orders/:id/notes")
  @UseGuards(JwtGuard, OrdersReadGuard)
  @McpTool({ description: "Adds a note to an order." })
  addOrderNote(
    @Param("id", ParseIntPipe) id: number,
    @Query("notify", new ParseBoolPipe({ optional: true }))
    notify: boolean | undefined,
    @Body() note: AddNoteDto,
  ): { id: number; notes: string[]; notified: boolean } {
    const order = this.require(id);
    order.notes.push(note.text);
    return { id: order.id, notes: order.notes, notified: notify === true };
  }

  @Post("orders")
  @UseGuards(JwtGuard, OrdersReadGuard)
  @McpTool({ description: "Creates a new order." })
  createOrder(
    @Body() body: CreateOrderDto,
    @Req() request: AuthedRequest,
  ): Order {
    const order: Order = {
      id: this.nextId++,
      item: body.item,
      quantity: body.quantity,
      owner: String(request.user?.sub ?? "unknown"),
      notes: [],
    };
    this.orders.set(order.id, order);
    return order;
  }

  private require(id: number): Order {
    const order = this.orders.get(id);
    if (order === undefined) {
      throw new NotFoundException(`order ${String(id)} not found`);
    }
    return order;
  }
}
