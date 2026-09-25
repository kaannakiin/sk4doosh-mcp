import { readCookie, writeCookie } from "./cookie";

export const NAVBAR_COOKIE = "chat_navbar";

const COLLAPSED = "collapsed";

export function rememberNavbarCollapsed(collapsed: boolean): void {
  writeCookie(NAVBAR_COOKIE, collapsed ? COLLAPSED : "expanded");
}

export function parseNavbarCookie(value: string | undefined): boolean {
  return value === COLLAPSED;
}

export function readNavbarCookie(): string | undefined {
  return readCookie(NAVBAR_COOKIE);
}
