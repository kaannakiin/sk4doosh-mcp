import type { ReactNode } from "react";

interface FilterStripProps {
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Guard: below `sm` the strip scrolls sideways and bleeds to the screen edge
 * with `-mx-4 px-4`, which mirrors the `px-4` gutter of the connections layout.
 * The Turkish filter labels are wider than a phone, and a segmented control
 * that wraps or shrinks breaks into unreadable fragments.
 */
export function FilterStrip({ className = "", children }: FilterStripProps) {
  return (
    <div
      className={`-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] *:shrink-0 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 ${className}`}
    >
      {children}
    </div>
  );
}
