/**
 * Guard: header names, hosts and methods are ASCII by protocol, and a locale-sensitive
 * `toLowerCase` turns `I` into a dotless `ı` under a Turkish locale, so a host or header would stop
 * matching its allowlist or carrier entry on such a machine.
 */
export const asciiLower = (value: string): string =>
  value.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

export const asciiUpper = (value: string): string =>
  value.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
