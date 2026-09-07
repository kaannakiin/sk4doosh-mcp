import { createFileRoute, notFound } from "@tanstack/react-router";
import { Container, Typography } from "@mantine/core";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDoc } from "../lib/content";

export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => {
    const doc = getDoc(params.slug);
    if (!doc) {
      throw notFound();
    }
    return doc;
  },
  head: ({ loaderData }) => ({
    meta: loaderData ? [{ title: `${loaderData.title} — sk-mcp` }] : [],
  }),
  component: DocPage,
});

function DocPage() {
  const doc = Route.useLoaderData();

  return (
    <Container size="md" px={0}>
      <Typography>
        <Markdown remarkPlugins={[remarkGfm]}>{doc.body}</Markdown>
      </Typography>
    </Container>
  );
}
