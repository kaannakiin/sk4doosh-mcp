import {
  sendMessageRequestSchema,
  type SendMessageRequest,
  type SendMessageResponse,
} from "@chat/contracts";
import { Body, Controller, Post } from "@nestjs/common";

import { ChatService } from "./chat.service.ts";

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  send(
    @Body({ schema: sendMessageRequestSchema }) body: SendMessageRequest,
  ): SendMessageResponse {
    return this.chat.send(body);
  }
}
