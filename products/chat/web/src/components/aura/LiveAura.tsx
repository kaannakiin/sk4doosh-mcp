import { useComputedColorScheme } from "@mantine/core";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { mountAura } from "./aura-gpu";
import type { AuraState } from "./aura-variant";
import { AuraStill } from "./AuraStill";
import { nacreAura } from "./nacre/variant";

export interface LiveAuraProps {
  readonly state: AuraState;
  readonly onFailure: () => void;
}

const MAX_DPR = 2;

export function LiveAura({ state, onFailure }: LiveAuraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  const scheme = useComputedColorScheme("light");
  /**
   * Guard: the frame loop reads the state and the scheme through Effect
   * Events, never through the mount effect's dependencies. Re-running that
   * effect on either change would rebuild the canvas and throw away the springs
   * that turn thinking into speaking, or light into dark, as a transition
   * rather than a cut.
   */
  const readState = useEffectEvent(() => state);
  const readScheme = useEffectEvent(() => scheme);
  const notifyFailure = useEffectEvent(onFailure);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }

    return mountAura({
      canvas,
      variant: nacreAura,
      state: readState,
      scheme: readScheme,
      maxDpr: MAX_DPR,
      onFirstFrame: () => setPainted(true),
      onFailure: notifyFailure,
    });
  }, []);

  return (
    <>
      <AuraStill hidden={painted} />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 size-full transition-opacity duration-300 ${painted ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
}
