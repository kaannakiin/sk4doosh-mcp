import { createFileRoute, notFound } from "@tanstack/react-router";
import { Container, Typography } from "@mantine/core";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocsNotFound } from "../components/DocsNotFound";
import { getDoc, getProduct } from "../lib/content";

export const Route = createFileRoute("/docs/$product/$slug")({
  loader: ({ params }) => {
    const product = getProduct(params.product);
    const doc = getDoc(params.product, params.slug);
    if (!product || !doc) {
      throw notFound();
    }
    return { title: doc.title, body: doc.body, productLabel: product.label };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [{ title: `${loaderData.title} — ${loaderData.productLabel} — sk-mcp` }]
      : [],
  }),
  component: DocPage,
  notFoundComponent: DocsNotFound,
});

function DocPage() {
  const { body } = Route.useLoaderData();

  return (
    <Container size="md" px={0}>
      <Typography>
        <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
      </Typography>
    </Container>
  );
}
