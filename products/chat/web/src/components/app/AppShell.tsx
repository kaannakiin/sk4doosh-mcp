import { Burger, Drawer } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Outlet } from "@tanstack/react-router";
import { Activity, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { SessionSidebar } from "./SessionSidebar";

const DESKTOP_COLUMN = "(width >= 64rem)";

/**
 * Guard: the drawer is always mounted and only its trigger is hidden above the
 * breakpoint. A drawer rendered behind a media-query hook flickers on hydration,
 * because the first client render has no window to measure.
 */
export function AppShell() {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);

  /**
   * Guard: the breakpoint is measured in an effect and never read during render,
   * so the first client pass still matches the server's. Growing into the
   * desktop column closes the drawer, which is what keeps the column from
   * sitting blank behind a drawer that no longer has a trigger.
   */
  useEffect(() => {
    const column = window.matchMedia(DESKTOP_COLUMN);
    const sync = () => {
      if (column.matches) {
        close();
      }
    };
    sync();
    column.addEventListener("change", sync);

    return () => {
      column.removeEventListener("change", sync);
    };
  }, [close]);

  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-r border-hairline bg-panel lg:block">
        <Activity mode={opened ? "hidden" : "visible"}>
          <SessionSidebar onNavigate={close} />
        </Activity>
      </aside>

      <Drawer
        opened={opened}
        onClose={close}
        size="17rem"
        padding={0}
        withCloseButton={false}
        aria-label={t("sessions.title")}
      >
        <SessionSidebar onNavigate={close} />
      </Drawer>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-hairline bg-panel px-4 py-2.5 lg:hidden">
          <Burger
            opened={opened}
            onClick={open}
            size="sm"
            aria-label={t("sessions.title")}
          />
          <span className="font-serif text-base tracking-[0.01em]">
            {t("app.title")}
          </span>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
