import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Container,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";

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

        <Group>
          <Button
            component={Link}
            to="/docs"
            size="md"
            rightSection={<IconArrowRight size={18} />}
          >
            Documentation
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}
