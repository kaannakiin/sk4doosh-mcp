import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { McpTool } from "@sk-mcp/sdk-nestjs";
import { IsOptional, IsString } from "class-validator";
import { JwtGuard, OrdersReadGuard } from "./auth.js";

export class AttachmentNoteDto {
  @IsString()
  @IsOptional()
  note?: string;
}

interface UploadedAttachment {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

@Controller("orders")
export class AttachmentsController {
  @Post(":id/attachments")
  @UseGuards(JwtGuard, OrdersReadGuard)
  @McpTool({
    description: "Attaches a file to an order.",
    files: {
      attachment: { required: true, description: "The file to attach." },
    },
  })
  @UseInterceptors(FileInterceptor("attachment"))
  attach(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile() file: UploadedAttachment | undefined,
    @Body() body: AttachmentNoteDto,
  ) {
    return {
      orderId: id,
      note: body.note ?? null,
      file:
        file === undefined
          ? null
          : { name: file.originalname, type: file.mimetype, size: file.size },
    };
  }
}
