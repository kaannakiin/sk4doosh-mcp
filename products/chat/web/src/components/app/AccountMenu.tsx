import { chatKeys } from "@chat/queries/keys";
import { useLogout } from "@chat/queries/auth/mutations";
import { Avatar, Menu, UnstyledButton } from "@mantine/core";
import { IconLogout, IconSelector } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { LocaleSwitcher } from "~/components/LocaleSwitcher";
import { ThemeSwitcher } from "~/components/ThemeSwitcher";
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
  const name = `${user.firstName} ${user.lastName}`.trim();

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
    <Menu position="top-start" width="target" withinPortal shadow="sm">
      <Menu.Target>
        <UnstyledButton
          className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-raised"
          aria-label={t("auth.account.menu")}
        >
          <Avatar name={name} color="initials" size={30} radius="xl" />
          <span className="min-w-0 flex-1 truncate text-start text-sm text-ink">
            {name}
          </span>
          <IconSelector className="shrink-0 text-ink-dim" size={15} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("locale.label")}</Menu.Label>
        <div className="px-2 pb-1.5">
          <LocaleSwitcher />
        </div>
        <Menu.Label>{t("theme.label")}</Menu.Label>
        <div className="px-2 pb-1.5">
          <ThemeSwitcher />
        </div>
        <Menu.Divider />
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
  );
}
