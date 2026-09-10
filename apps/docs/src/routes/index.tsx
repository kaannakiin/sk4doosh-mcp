import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Badge,
  Card,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { products } from "../lib/content";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <Container size="md" className="py-24">
      <Group justify="flex-end">
        <ColorSchemeToggle />
      </Group>

      <Stack gap="xl" className="mt-16">
        <Badge variant="light" size="lg" className="self-start">
          Swagger for Agents
        </Badge>

        <Title order={1} className="text-balance !text-5xl sm:!text-6xl">
          sk-mcp
        </Title>

        <Text size="xl" c="dimmed" className="max-w-2xl">
          An MCP layer that embeds into your existing backend. One normative
          spec, one SDK per language. Exposing an endpoint to an agent no longer
          means writing another service.
        </Text>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" className="mt-4">
          {products.map((product) => (
            <Link
              key={product.id}
              to="/docs/$product/$slug"
              params={{ product: product.id, slug: product.firstSlug }}
              className="no-underline text-inherit"
            >
              <Card withBorder radius="md" padding="lg" h="100%">
                <Group justify="space-between" wrap="nowrap">
                  <Title order={3} size="h4">
                    {product.label}
                  </Title>
                  <IconArrowRight size={18} />
                </Group>
                <Text size="sm" c="dimmed" mt="xs">
                  {product.tagline}
                </Text>
              </Card>
            </Link>
          ))}
        </SimpleGrid>
      </Stack>
    </Container>
  );
}
