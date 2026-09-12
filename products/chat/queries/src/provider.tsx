import { createContext, useContext, type ReactNode } from "react";

import type { ChatClient } from "./client.ts";

const ChatClientContext = createContext<ChatClient | undefined>(undefined);

export function ChatClientProvider({
  client,
  children,
}: {
  client: ChatClient;
  children: ReactNode;
}) {
  return (
    <ChatClientContext value={client}>{children}</ChatClientContext>
  );
}

export function useChatClient(): ChatClient {
  const client = useContext(ChatClientContext);
  if (client === undefined) {
    throw new Error("useChatClient requires a ChatClientProvider ancestor.");
  }

  return client;
}
