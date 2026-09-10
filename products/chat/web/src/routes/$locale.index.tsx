import { createFileRoute } from "@tanstack/react-router";

import { ChatScreen } from "../components/ChatScreen";

export const Route = createFileRoute("/$locale/")({
  component: ChatScreen,
});
