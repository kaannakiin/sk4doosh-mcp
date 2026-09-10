import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { DocsNotFound } from "../components/DocsNotFound";
import { getProduct } from "../lib/content";

export const Route = createFileRoute("/docs/$product/")({
  beforeLoad: ({ params }) => {
    const product = getProduct(params.product);
    if (!product) {
      throw notFound();
    }
    throw redirect({
      to: "/docs/$product/$slug",
      params: { product: product.id, slug: product.firstSlug },
    });
  },
  component: () => null,
  notFoundComponent: DocsNotFound,
});
