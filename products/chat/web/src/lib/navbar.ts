import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import {
  NAVBAR_COOKIE,
  parseNavbarCookie,
  readNavbarCookie,
} from "./navbar-cookie";

const readOnServer = createServerFn().handler(() =>
  parseNavbarCookie(getCookie(NAVBAR_COOKIE)),
);

/**
 * Resolves whether the desktop navbar starts collapsed.
 *
 * Guard: the server answers from the request cookie so the first paint already
 * has the reader's width. Deciding on the client alone would render the
 * expanded navbar and then slide it shut after hydration.
 */
export async function resolveNavbarCollapsed(): Promise<boolean> {
  if (typeof document === "undefined") {
    return readOnServer();
  }

  return parseNavbarCookie(readNavbarCookie());
}
