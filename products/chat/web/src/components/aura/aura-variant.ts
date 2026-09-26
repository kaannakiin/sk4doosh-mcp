import type { d } from "typegpu";

export type AuraState = "idle" | "thinking" | "speaking";

export type AuraScheme = "light" | "dark";

export interface AuraBaseUniforms {
  time: d.F32;
  anim: d.F32;
  inputVol: d.F32;
  outputVol: d.F32;
  res: d.Vec2f;
}

/**
 * The struct a variant binds at `@group(0) @binding(0)`: the base fields plus
 * one `p_<key>: f32` per param and one `c_<key>: vec3f` per colour.
 */
export type AuraUniformStruct = d.WgslStruct<
  AuraBaseUniforms & Record<string, d.AnyWgslData>
>;

export interface AuraParam {
  readonly key: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly integrate?: boolean;
}

export interface AuraColor {
  readonly key: string;
  readonly default: string;
}

export interface AuraVariant {
  readonly key: string;
  readonly shader: string;
  readonly uniforms: AuraUniformStruct;
  readonly params: readonly AuraParam[];
  readonly colors: readonly AuraColor[];
  readonly statePresets: Readonly<
    Record<AuraState, Readonly<Record<string, number>>>
  >;
  readonly palettes: Readonly<
    Record<AuraScheme, Record<AuraState, Readonly<Record<string, string>>>>
  >;
}
