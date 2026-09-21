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
import { Transform, Type } from "class-transformer";
import { McpTool } from "@sk-mcp/sdk-nestjs";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
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

/**
 * A named `@Query('filter')` binding, so the sample exercises `query.grouping` end to end. The
 * handler echoes the DTO the pipe produced, which is the only direct evidence that the key the
 * composer wrote is the key Express actually parsed.
 */
export class OrderFilterDto {
  @IsString()
  @IsOptional()
  owner?: string;

  @IsInt()
  @IsOptional()
  @Type(() => Number)
  minQuantity?: number;

  /**
   * Guard: a query key that appears once parses to a string, not a one-element array — the same
   * in `?items=a` and `?filter[items]=a`. Every Express host with an array query member needs
   * this, grouped or not.
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || Array.isArray(value) ? value : [value],
  )
  items?: string[];
}

export class OrderResponse {
  @IsInt()
  id!: number;

  @IsString()
  item!: string;

  @IsInt()
  quantity!: number;

  @IsString()
  owner!: string;
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

  @Get("orders")
  @UseGuards(JwtGuard, OrdersReadGuard)
  @McpTool({
    description:
      "Searches orders by a filter object, echoing the filter the pipe produced.",
  })
  search(@Query("filter") filter: OrderFilterDto): {
    echoed: OrderFilterDto;
    matched: Order[];
  } {
    const wanted = filter ?? {};
    return {
      echoed: wanted,
      matched: [...this.orders.values()].filter(
        (order) =>
          (wanted.owner === undefined || order.owner === wanted.owner) &&
          (wanted.minQuantity === undefined ||
            order.quantity >= wanted.minQuantity) &&
          (wanted.items === undefined ||
            wanted.items.length === 0 ||
            wanted.items.includes(order.item)),
      ),
    };
  }

  @Get("orders/:id")
  @UseGuards(JwtGuard, OrdersReadGuard)
  @McpTool({
    description: "Fetches one order by id.",
    responses: { 200: OrderResponse, 404: {} },
  })
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
