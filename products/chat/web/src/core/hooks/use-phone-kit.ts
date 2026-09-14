import { useEffect, useState } from "react";

export type PhoneKit = typeof import("libphonenumber-js/mobile");

let pending: Promise<PhoneKit> | undefined;

/**
 * Guard: the metadata is the `mobile` variant, not `min`. `min` validates length
 * only, so a Turkish landline passes it and the registration burns an SMS on a
 * number that can never receive one. Under `mobile` metadata `isValid()` is
 * already "dialable as a mobile", which is why nothing here inspects `getType()`.
 *
 * Guard: the import is dynamic and the promise is cached at module scope. The
 * bundle is ~39 KB gzipped — an order of magnitude more than this screen — and a
 * per-component promise would fetch it once per mounted field.
 */
function load(): Promise<PhoneKit> {
  pending ??= import("libphonenumber-js/mobile");
  return pending;
}

/** Starts fetching the phone metadata without waiting for it. */
export function preloadPhoneKit(): void {
  void load();
}

/**
 * The phone metadata once it has arrived, `undefined` until then.
 *
 * Guard: always `undefined` on the first render, even when the module is already
 * cached. Seeding from the cache would let the client's first pass render
 * formatted text the server never produced, and the country list is 245 options
 * the server does not have.
 */
export function usePhoneKit(): PhoneKit | undefined {
  const [kit, setKit] = useState<PhoneKit>();

  useEffect(() => {
    let alive = true;

    void load().then((loaded) => {
      if (alive) {
        setKit(loaded);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  return kit;
}
