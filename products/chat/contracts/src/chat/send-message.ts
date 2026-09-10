import { z } from "zod";

import { chatMessageSchema } from "./message.ts";

export const MESSAGE_MAX_LENGTH = 4000;

export const sendMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendMessageResponseSchema = z.object({
  message: chatMessageSchema,
  reply: chatMessageSchema,
});

export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
