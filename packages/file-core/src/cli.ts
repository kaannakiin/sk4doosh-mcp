export type ArgvOutcome =
  { readonly kind: "root"; readonly path: string } | { readonly kind: "usage" };

export function parseServerArgv(argv: readonly string[]): ArgvOutcome {
  const [, , rootArgument, ...rest] = argv;
  if (
    rootArgument === undefined ||
    rootArgument.startsWith("-") ||
    rest.length > 0
  ) {
    return { kind: "usage" };
  }
  return { kind: "root", path: rootArgument };
}
