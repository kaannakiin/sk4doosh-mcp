import { PRODUCT_NAME } from "@chat/contracts/common/product";
import { ActionIcon, Burger, AppShell as MantineAppShell } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconX,
} from "@tabler/icons-react";
import { Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useMediaMatchEffect } from "~/core/hooks/use-media-match-effect";
import { rememberNavbarCollapsed } from "~/lib/navbar-cookie";
import { SessionSidebar } from "./SessionSidebar";

const NAVBAR_BREAKPOINT = "64rem";

const DESKTOP_COLUMN = `(width >= ${NAVBAR_BREAKPOINT})`;

const NAVBAR_WIDTH = 272;

export interface AppShellProps {
  readonly initialCollapsed: boolean;
}

/**
 * Guard: every breakpoint decision is CSS — Mantine's media variables and the
 * `lg:`/`max-lg:` utilities — and never a media-query hook read during render.
 * The first client render has no window to measure, so a hook would render the
 * server's guess and then flicker.
 */
export function AppShell({ initialCollapsed }: AppShellProps) {
  const { t } = useTranslation();
  const [mobileOpened, mobile] = useDisclosure(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  /**
   * Guard: growing into the desktop column closes the mobile navbar. Left open,
   * shrinking the window again would bring the full-screen navbar back over the
   * conversation with nobody having asked for it.
   */
  useMediaMatchEffect(DESKTOP_COLUMN, mobile.close);

  const toggleDesktop = () => {
    const next = !collapsed;
    setCollapsed(next);
    rememberNavbarCollapsed(next);
  };

  /**
   * Guard: a collapsed navbar is only translated off screen, so without
   * `invisible` its links stay in the tab order and the accessibility tree.
   * `visibility` is transitioned with the transform, which lets the slide-out
   * finish before it flips.
   */
  const offscreen = [
    mobileOpened ? "" : "max-lg:invisible",
    collapsed ? "lg:invisible" : "",
  ].join(" ");

  return (
    <MantineAppShell
      withBorder={false}
      navbar={{
        width: NAVBAR_WIDTH,
        breakpoint: NAVBAR_BREAKPOINT,
        collapsed: { mobile: !mobileOpened, desktop: collapsed },
      }}
    >
      <MantineAppShell.Navbar
        className={`bg-panel [transition-property:transform,visibility] lg:border-e lg:border-hairline ${offscreen}`}
      >
        <SessionSidebar
          onNavigate={mobile.close}
          controls={
            <>
              <ActionIcon
                className="lg:hidden"
                variant="subtle"
                color="gray"
                onClick={mobile.close}
                aria-label={t("shell.close")}
              >
                <IconX size={18} />
              </ActionIcon>
              <ActionIcon
                className="max-lg:hidden"
                variant="subtle"
                color="gray"
                onClick={toggleDesktop}
                aria-label={t("shell.collapse")}
              >
                <IconLayoutSidebarLeftCollapse size={18} />
              </ActionIcon>
            </>
          }
        />
      </MantineAppShell.Navbar>

      <MantineAppShell.Main className="flex h-dvh min-w-0 flex-col overflow-hidden">
        <header
          className={[
            "flex items-center gap-3 border-b border-hairline bg-panel px-4 py-2.5",
            collapsed ? "" : "lg:hidden",
          ].join(" ")}
        >
          <Burger
            className="lg:hidden"
            opened={mobileOpened}
            onClick={mobile.open}
            size="sm"
            aria-label={t("shell.open")}
          />
          <ActionIcon
            className="max-lg:hidden"
            variant="subtle"
            color="gray"
            onClick={toggleDesktop}
            aria-label={t("shell.expand")}
          >
            <IconLayoutSidebarLeftExpand size={18} />
          </ActionIcon>
          <span className="font-serif text-base tracking-[0.01em]">
            {PRODUCT_NAME}
          </span>
        </header>
        <Outlet />
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
