import { useReducedMotion } from "@mantine/hooks";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";

import type { AuraState } from "./aura-variant";
import { AuraStill } from "./AuraStill";

/**
 * Guard: the live canvas is a lazy chunk behind `ClientOnly`. It carries
 * TypeGPU and the resolved shader, which neither the SSR render nor a browser
 * without WebGPU should pay for, and the server has no `navigator.gpu` to
 * render it against anyway.
 */
const LiveAura = lazy(async () => ({
  default: (await import("./LiveAura")).LiveAura,
}));

export interface AssistantAuraProps {
  readonly state: AuraState;
  readonly className: string;
}

function supportsWebGpu(): boolean {
  return typeof navigator !== "undefined" && navigator.gpu !== undefined;
}

const STILL = <AuraStill />;

/**
 * The assistant's presence mark. A still gradient stands in until the first
 * WebGPU frame lands, and stays for good under reduced motion, without WebGPU,
 * or once the device is lost.
 */
export function AssistantAura({ state, className }: AssistantAuraProps) {
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);

  return (
    <span
      aria-hidden
      data-state={state}
      className={`chat-aura relative isolate inline-block shrink-0 ${className}`}
    >
      {reduceMotion || failed ? (
        STILL
      ) : (
        <ClientOnly fallback={STILL}>
          {supportsWebGpu() ? (
            <Suspense fallback={STILL}>
              <LiveAura state={state} onFailure={() => setFailed(true)} />
            </Suspense>
          ) : (
            STILL
          )}
        </ClientOnly>
      )}
    </span>
  );
}
