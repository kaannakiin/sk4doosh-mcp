import { d } from "typegpu";

import type {
  AuraBaseUniforms,
  AuraScheme,
  AuraState,
  AuraUniformStruct,
  AuraVariant,
} from "./aura-variant";

const F32_BYTES = 4;
const UNIFORM_ALIGN = 16;
const PARAM_EASE = 4;
const VOLUME_EASE = 12;
const MAX_STEP = 0.05;

export interface AuraScene {
  readonly image: Float32Array<ArrayBuffer>;
  advance(dt: number, state: AuraState, scheme: AuraScheme): void;
  resize(width: number, height: number): void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function targetVolumes(state: AuraState, t: number): [number, number] {
  if (state === "speaking") {
    return [
      clamp01(0.65 + Math.sin(t * 4.8) * 0.22),
      clamp01(0.75 + Math.sin(t * 3.6) * 0.22),
    ];
  }
  if (state === "thinking") {
    const base = 0.38 + 0.07 * Math.sin(t * 0.7);
    const wander = 0.05 * Math.sin(t * 2.1) * Math.sin(t * 0.37 + 1.2);

    return [
      clamp01(base + wander),
      clamp01(0.48 + 0.12 * Math.sin(t * 1.05 + 0.6)),
    ];
  }

  return [0, 0.3];
}

function rgb(hex: string): number[] {
  const n = Number.parseInt(hex.slice(1), 16);

  return [
    Math.floor(n / 0x1_00_00) / 255,
    (Math.floor(n / 0x1_00) % 256) / 255,
    (n % 256) / 255,
  ];
}

/**
 * Guard: the `p_`/`c_` fields are named after runtime data, so they are the one
 * part of the uniform layout the compiler cannot check. A variant whose struct
 * misses a field would otherwise write its floats over a neighbour.
 */
function floatSlot(
  schema: AuraUniformStruct,
  field: string,
  expected: "f32" | "vec3f",
): number {
  const declared = schema.propTypes[field];
  if (declared?.type !== expected) {
    throw new Error(`aura uniform '${field}' must be ${expected}`);
  }

  return d.memoryLayoutOf(schema, (fields) => fields[field]).offset / F32_BYTES;
}

/**
 * Springs every param and colour toward the state's preset and writes them into
 * one reused uniform image.
 * @param variant The aura whose struct and presets drive the image.
 * @param initial The state the aura starts at rest in.
 * @param scheme The colour scheme whose palette it starts in.
 * @returns The image to upload each frame and the two calls that update it.
 */
export function createAuraScene(
  variant: AuraVariant,
  initial: AuraState,
  scheme: AuraScheme,
): AuraScene {
  const schema = variant.uniforms;
  const image = new Float32Array(
    (Math.ceil(d.sizeOf(schema) / UNIFORM_ALIGN) * UNIFORM_ALIGN) / F32_BYTES,
  );
  const baseSlot = (field: keyof AuraBaseUniforms) =>
    d.memoryLayoutOf(schema, (fields) => fields[field]).offset / F32_BYTES;
  const timeSlot = baseSlot("time");
  const animSlot = baseSlot("anim");
  const inputSlot = baseSlot("inputVol");
  const outputSlot = baseSlot("outputVol");
  const resSlot = baseSlot("res");
  const spring = { x: 0, v: 0 };
  const step = (x: number, v: number, target: number, dt: number) => {
    const f = 1 + 2 * dt * PARAM_EASE;
    const hoo = dt * PARAM_EASE * PARAM_EASE;
    const hhoo = dt * hoo;
    const detInv = 1 / (f + hhoo);
    spring.x = (f * x + dt * v + hhoo * target) * detInv;
    spring.v = (v + hoo * (target - x)) * detInv;
  };

  const params = variant.params.map((param) => {
    const clock = param.integrate === true ? Math.random() * 100 : 0;
    const slot = floatSlot(schema, `p_${param.key}`, "f32");
    image[slot] = param.integrate === true ? clock : param.default;

    return { param, slot, value: param.default, velocity: 0, clock };
  });
  const colors = variant.colors.map((color) => {
    const targetsIn = (palette: AuraVariant["palettes"][AuraScheme]) => ({
      idle: rgb(palette.idle[color.key] ?? color.default),
      thinking: rgb(palette.thinking[color.key] ?? color.default),
      speaking: rgb(palette.speaking[color.key] ?? color.default),
    });
    const targets: Record<AuraScheme, Record<AuraState, number[]>> = {
      light: targetsIn(variant.palettes.light),
      dark: targetsIn(variant.palettes.dark),
    };
    const value = [...targets[scheme][initial]];
    const slot = floatSlot(schema, `c_${color.key}`, "vec3f");
    image.set(value, slot);

    return { slot, value, targets, velocity: [0, 0, 0] };
  });

  let [volumeIn, volumeOut] = targetVolumes(initial, 0);
  let seconds = 0;
  let anim = Math.random() * 100;
  let speed = 0.1;
  let speedVel = 0;

  const stepDrive = (dt: number, state: AuraState) => {
    const [targetIn, targetOut] = targetVolumes(state, seconds);
    const k = 1 - Math.exp(-dt * VOLUME_EASE);
    volumeIn += (targetIn - volumeIn) * k;
    volumeOut += (targetOut - volumeOut) * k;
    step(speed, speedVel, 0.1 + (1 - (volumeOut - 1) ** 2) * 0.9, dt);
    speed = spring.x;
    speedVel = spring.v;
    anim += dt * speed;
    image[timeSlot] = seconds * 0.5;
    image[animSlot] = anim;
    image[inputSlot] = volumeIn;
    image[outputSlot] = volumeOut;
  };

  /**
   * Guard: every target is clamped to the param's declared range, presets
   * included. Several shaders read a param as a divisor or a smoothstep edge,
   * and a value past the range they were written against inverts or blows up
   * the image.
   */
  const stepParams = (dt: number, state: AuraState) => {
    const preset = variant.statePresets[state];
    for (const entry of params) {
      const { param } = entry;
      const target = Math.min(
        param.max,
        Math.max(param.min, preset[param.key] ?? param.default),
      );
      step(entry.value, entry.velocity, target, dt);
      entry.value = spring.x;
      entry.velocity = spring.v;
      if (param.integrate === true) {
        entry.clock += dt * speed * spring.x;
        image[entry.slot] = entry.clock;
      } else {
        image[entry.slot] = spring.x;
      }
    }
  };

  const stepColors = (dt: number, state: AuraState, scheme: AuraScheme) => {
    for (const entry of colors) {
      const target = entry.targets[scheme][state];
      for (let channel = 0; channel < 3; channel += 1) {
        step(
          entry.value[channel] ?? 0,
          entry.velocity[channel] ?? 0,
          target[channel] ?? 0,
          dt,
        );
        entry.value[channel] = spring.x;
        entry.velocity[channel] = spring.v;
      }
      image.set(entry.value, entry.slot);
    }
  };

  return {
    image,
    advance(dt, state, scheme) {
      const clamped = Math.min(dt, MAX_STEP);
      seconds += clamped;
      stepDrive(clamped, state);
      stepParams(clamped, state);
      stepColors(clamped, state, scheme);
    },
    resize(width, height) {
      image[resSlot] = width;
      image[resSlot + 1] = height;
    },
  };
}
