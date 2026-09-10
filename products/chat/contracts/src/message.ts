import { z } from "zod";

export const MESSAGE_MAX_LENGTH = 4000;

export const messageRoleSchema = z.enum(["user", "assistant"]);

export type MessageRole = z.infer<typeof messageRoleSchema>;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.iso.datetime(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const sendMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendMessageResponseSchema = z.object({
  message: chatMessageSchema,
  reply: chatMessageSchema,
});

export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
