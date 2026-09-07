import { Link, Outlet, createFileRoute, useMatchRoute } from '@tanstack/react-router'
import { AppShell, Box, Burger, Group, NavLink, ScrollArea, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { ColorSchemeToggle } from '../components/ColorSchemeToggle'
import { sections } from '../lib/content'

export const Route = createFileRoute('/docs')({
  component: DocsLayout,
})

function DocsLayout() {
  const [opened, { toggle, close }] = useDisclosure(false)
  const matchRoute = useMatchRoute()

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text
              component={Link}
              to="/"
              fw={700}
              size="lg"
              className="no-underline text-inherit"
            >
              sk-mcp
            </Text>
          </Group>
          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <ScrollArea type="scroll">
          {sections.map((section) => (
            <Box key={section.key ?? 'root'} mb="sm">
              {section.label !== '' && (
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="xs" pb={4}>
                  {section.label}
                </Text>
              )}
              {section.docs.map((doc) => (
                <NavLink
                  key={doc.slug}
                  label={doc.title}
                  active={!!matchRoute({ to: '/docs/$slug', params: { slug: doc.slug } })}
                  onClick={close}
                  renderRoot={(props) => (
                    <Link to="/docs/$slug" params={{ slug: doc.slug }} {...props} />
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
  )
}
