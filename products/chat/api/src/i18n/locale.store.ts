import { AsyncLocalStorage } from "node:async_hooks";

import type { Locale } from "@chat/contracts";

const storage = new AsyncLocalStorage<Locale>();

export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}

export function currentLocale(): Locale | undefined {
  return storage.getStore();
}
