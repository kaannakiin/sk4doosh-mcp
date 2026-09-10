import { createFileRoute, redirect } from "@tanstack/react-router";
import { defaultProduct } from "../lib/content";

export const Route = createFileRoute("/docs/")({
  beforeLoad: () => {
    if (defaultProduct) {
      throw redirect({
        to: "/docs/$product/$slug",
        params: {
          product: defaultProduct.id,
          slug: defaultProduct.firstSlug,
        },
      });
    }
  },
  component: () => null,
});
