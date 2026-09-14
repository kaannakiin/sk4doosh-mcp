import { useEffect, useRef, type ReactNode } from "react";

/**
 * Guard: the heading takes focus on mount, via a ref rather than `autoFocus`.
 * A route change in a single page app moves nothing for a screen reader, so
 * without this the reader is left where they were while the content silently
 * changed. `autoFocus` will not do it — browsers honour that attribute on form
 * controls, not on a heading.
 *
 * @param takeFocus pass `false` where the screen's own first control is the
 * next action, so focus is not pulled back out of it
 */
export function AuthHeading({
  title,
  subtitle,
  takeFocus = true,
}: Readonly<{ title: string; subtitle?: ReactNode; takeFocus?: boolean }>) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (takeFocus) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [takeFocus]);

  return (
    <header>
      <h2
        ref={heading}
        tabIndex={-1}
        className="font-serif text-[1.75rem] leading-[1.2] font-medium tracking-[-0.01em] text-ink outline-none"
      >
        {title}
      </h2>
      {subtitle === undefined ? null : (
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-dim">
          {subtitle}
        </p>
      )}
    </header>
  );
}
