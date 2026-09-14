import { createLink } from "@tanstack/react-router";
import type { AnchorHTMLAttributes } from "react";

/**
 * Guard: built with `createLink`, not by wrapping `Link` in a plain component.
 * A hand-rolled wrapper types its props as the non-generic link and erases the
 * router's inference — `to` and `search` degrade to loose strings and stop being
 * checked against the route tree at all.
 */
function Styled({
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className={`text-accent underline underline-offset-2 ${className}`}
    />
  );
}

export const AuthLink = createLink(Styled);
