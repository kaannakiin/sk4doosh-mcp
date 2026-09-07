import { createFileRoute, redirect } from "@tanstack/react-router";
import { firstDocSlug } from "../lib/content";

export const Route = createFileRoute("/docs/")({
  beforeLoad: () => {
    if (firstDocSlug) {
      throw redirect({ to: "/docs/$slug", params: { slug: firstDocSlug } });
    }
  },
  component: () => null,
});
