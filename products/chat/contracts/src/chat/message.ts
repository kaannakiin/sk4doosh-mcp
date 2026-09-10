import { z } from "zod";

export const messageRoleSchema = z.enum(["user", "assistant"]);

export type MessageRole = z.infer<typeof messageRoleSchema>;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.iso.datetime(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
