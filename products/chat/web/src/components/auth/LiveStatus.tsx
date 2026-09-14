/**
 * Guard: one polite region per screen, carrying only non-error transitions.
 * Mantine's `Alert` is `role="alert"` and announces itself the moment it mounts,
 * so routing failures through here as well would read every problem twice.
 */
export function LiveStatus({ message }: Readonly<{ message: string }>) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
