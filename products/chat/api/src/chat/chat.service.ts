import {
  type ChatMessage,
  type SendMessageRequest,
  type SendMessageResponse,
} from "@chat/contracts";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { I18nService } from "../i18n/i18n.service.ts";

@Injectable()
export class ChatService {
  constructor(private readonly i18n: I18nService) {}

  send(request: SendMessageRequest): SendMessageResponse {
    const message = this.message("user", request.content);
    const reply = this.message(
      "assistant",
      this.i18n.t("chat.echo_reply", { content: request.content }),
    );

    return { message, reply };
  }

  private message(role: ChatMessage["role"], content: string): ChatMessage {
    return {
      id: randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString(),
    };
  }
}
