import { chatKeys } from "@chat/queries/keys";
import { useLogout } from "@chat/queries/auth/mutations";
import { ActionIcon, Menu, Text } from "@mantine/core";
import { IconDots, IconLogout } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { useLocale } from "~/core/hooks/use-locale";

/**
 * Guard: the user is read from the guarded route's context, not passed down. The
 * guard already resolved it before this subtree could render, so threading it
 * through the sidebar would only add a prop that can go stale.
 */
const route = getRouteApi("/_authenticated");

export function AccountMenu() {
  const { user } = route.useRouteContext();
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useLogout(locale);

  /**
   * Guard: the chat cache is dropped after the navigation resolves, not before.
   * Dropping it first leaves the conversation components mounted and refetching
   * against a session that no longer exists, and every one of those answers is a
   * 401 on the way out.
   */
  async function signOut(): Promise<void> {
    await logout.mutateAsync();
    await navigate({ to: "/auth/login", replace: true });
    queryClient.removeQueries({ queryKey: chatKeys.all });
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Text size="sm" c="var(--color-ink-dim)" truncate>
        {user.firstName} {user.lastName}
      </Text>
      <Menu position="top-start" withinPortal shadow="sm">
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={t("auth.account.menu")}
          >
            <IconDots size={15} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            color="red"
            leftSection={<IconLogout size={14} />}
            disabled={logout.isPending}
            onClick={() => {
              void signOut();
            }}
          >
            {t("auth.account.signOut")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
