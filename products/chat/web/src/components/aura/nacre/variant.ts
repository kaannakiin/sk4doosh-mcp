import { verdigris } from "~/theme";

import type { AuraVariant } from "../aura-variant";
import { nacreShader, nacreUniforms } from "./shader";

const PAPER = "#faf7f2";
const WHITE = "#ffffff";

export const nacreAura: AuraVariant = {
  key: "nacre",
  shader: nacreShader,
  uniforms: nacreUniforms,
  colors: [
    { key: "deep", default: verdigris[9] },
    { key: "low", default: verdigris[5] },
    { key: "crest", default: PAPER },
    { key: "sheen", default: verdigris[2] },
  ],
  params: [
    { key: "speed", default: 0.35, min: 0.015, max: 10, integrate: true },
    { key: "flow", default: 0.25, min: 0, max: 5, integrate: true },
    { key: "swirl", default: 0.06, min: 0, max: 3, integrate: true },
    { key: "radius", default: 0.9, min: 0.15, max: 3 },
    { key: "scale", default: 5.5, min: 0.3, max: 20 },
    { key: "bulge", default: 0.3, min: 0, max: 4 },
    { key: "warp", default: 1, min: 0, max: 3 },
    { key: "beat", default: 0, min: 0, max: 1 },
    { key: "thick", default: 0.2, min: 0.02, max: 2 },
    { key: "split", default: 0.03, min: 0, max: 1 },
    { key: "iris", default: 0.12, min: 0, max: 2 },
    { key: "irisScale", default: 0.315, min: 0, max: 2 },
    { key: "view", default: 1.34, min: 0, max: 3 },
    { key: "floor", default: 0.8, min: 0, max: 3 },
    { key: "gain", default: 1.1, min: 0.05, max: 5 },
    { key: "contrast", default: 1.15, min: 0.15, max: 10 },
    { key: "light", default: 0.9, min: 0, max: 3 },
    { key: "rim", default: 0.5, min: 0, max: 3 },
  ],
  statePresets: {
    idle: {
      bulge: 0.8,
      contrast: 1,
      floor: 0.85,
      flow: 0.2,
      gain: 0.55,
      iris: 0,
      rim: 0.35,
      scale: 3.2,
      speed: 0.3,
      split: 0,
      swirl: 0.05,
      thick: 0.3,
      warp: 0.7,
    },
    thinking: {
      bulge: 0.8,
      contrast: 1,
      floor: 0.85,
      flow: 0.06,
      gain: 0.6,
      iris: 0,
      rim: 0.35,
      scale: 3.2,
      speed: 1.1,
      split: 0,
      swirl: 0.02,
      thick: 0.3,
      warp: 0.95,
    },
    speaking: {
      beat: 0.35,
      bulge: 0.8,
      contrast: 1,
      floor: 0.85,
      flow: 1.2,
      gain: 0.6,
      iris: 0,
      rim: 0.4,
      scale: 3.2,
      speed: 1.4,
      split: 0,
      swirl: 0.1,
      thick: 0.24,
      warp: 1.05,
    },
  },
  palettes: {
    light: {
      idle: {
        deep: verdigris[2],
        low: verdigris[4],
        crest: PAPER,
        sheen: WHITE,
      },
      thinking: {
        deep: verdigris[2],
        low: verdigris[5],
        crest: PAPER,
        sheen: WHITE,
      },
      speaking: {
        deep: verdigris[2],
        low: verdigris[6],
        crest: PAPER,
        sheen: WHITE,
      },
    },
    dark: {
      idle: {
        deep: verdigris[8],
        low: verdigris[5],
        crest: verdigris[1],
        sheen: verdigris[3],
      },
      thinking: {
        deep: verdigris[8],
        low: verdigris[4],
        crest: verdigris[0],
        sheen: verdigris[2],
      },
      speaking: {
        deep: verdigris[7],
        low: verdigris[3],
        crest: PAPER,
        sheen: verdigris[2],
      },
    },
  },
};
