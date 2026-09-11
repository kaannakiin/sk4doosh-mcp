export interface ReaderCommand {
  readonly command: string;
  readonly args: string[];
}

/**
 * Guard: splits the configured command on whitespace and appends the sandbox
 * root as the final positional argument, which is the argv shape the readers
 * parse. No shell is involved anywhere on this path, so there is no quoting,
 * no expansion and no injection surface; the accepted cost is that a command
 * or a root containing a space cannot be expressed.
 */
export function readerCommandFor(
  raw: string,
  sandboxRoot: string,
): ReaderCommand | undefined {
  const parts = raw.split(/\s+/u).filter((part) => part.length > 0);
  const [command, ...rest] = parts;
  if (command === undefined) {
    return undefined;
  }

  return { command, args: [...rest, sandboxRoot] };
}
