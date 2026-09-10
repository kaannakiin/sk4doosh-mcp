import { Container, Text, Title } from "@mantine/core";

export function DocsNotFound() {
  return (
    <Container size="md" px={0}>
      <Title order={1}>Page not found</Title>
      <Text c="dimmed" mt="md">
        That documentation page does not exist. Pick a product or a page from
        the sidebar.
      </Text>
    </Container>
  );
}
