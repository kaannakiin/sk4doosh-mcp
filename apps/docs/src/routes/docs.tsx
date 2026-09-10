import {
  Link,
  Outlet,
  createFileRoute,
  useMatchRoute,
  useParams,
} from "@tanstack/react-router";
import {
  AppShell,
  Box,
  Burger,
  Divider,
  Group,
  NavLink,
  ScrollArea,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { defaultProduct, getProduct, products } from "../lib/content";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});

function GroupLabel({ children }: Readonly<{ children: string }>) {
  return (
    <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="xs" pb={4}>
      {children}
    </Text>
  );
}

function DocsLayout() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const matchRoute = useMatchRoute();
  const params = useParams({ strict: false });
  const active = getProduct(params.product ?? "") ?? defaultProduct;

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 280, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
            <Text
              component={Link}
              to="/"
              fw={700}
              size="lg"
              className="no-underline text-inherit"
            >
              sk-mcp
            </Text>
            {active && (
              <>
                <Text c="dimmed" visibleFrom="xs">
                  /
                </Text>
                <Text c="dimmed" size="sm" visibleFrom="xs">
                  {active.label}
                </Text>
              </>
            )}
          </Group>
          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <ScrollArea type="scroll">
          <Box mb="sm">
            <GroupLabel>Products</GroupLabel>
            {products.map((product) => (
              <NavLink
                key={product.id}
                label={product.label}
                active={product.id === active?.id}
                onClick={close}
                renderRoot={(props) => (
                  <Link
                    to="/docs/$product/$slug"
                    params={{ product: product.id, slug: product.firstSlug }}
                    {...props}
                  />
                )}
              />
            ))}
          </Box>

          <Divider mb="sm" />

          {active?.groups.map((group) => (
            <Box key={group.key ?? "root"} mb="sm">
              {group.label !== "" && <GroupLabel>{group.label}</GroupLabel>}
              {group.docs.map((doc) => (
                <NavLink
                  key={doc.slug}
                  label={doc.title}
                  active={
                    !!matchRoute({
                      to: "/docs/$product/$slug",
                      params: { product: doc.product, slug: doc.slug },
                    })
                  }
                  onClick={close}
                  renderRoot={(props) => (
                    <Link
                      to="/docs/$product/$slug"
                      params={{ product: doc.product, slug: doc.slug }}
                      {...props}
                    />
                  )}
                />
              ))}
            </Box>
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
