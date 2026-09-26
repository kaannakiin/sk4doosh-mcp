import { d, std, tgpu } from "typegpu";

const OCTAVES = 10;
const TAU = 6.283_185_307_18;

export const nacreUniforms = d.struct({
  anim: d.f32,
  c_crest: d.vec3f,
  c_deep: d.vec3f,
  c_low: d.vec3f,
  c_sheen: d.vec3f,
  inputVol: d.f32,
  outputVol: d.f32,
  p_beat: d.f32,
  p_bulge: d.f32,
  p_contrast: d.f32,
  p_floor: d.f32,
  p_flow: d.f32,
  p_gain: d.f32,
  p_iris: d.f32,
  p_irisScale: d.f32,
  p_light: d.f32,
  p_radius: d.f32,
  p_rim: d.f32,
  p_scale: d.f32,
  p_speed: d.f32,
  p_split: d.f32,
  p_swirl: d.f32,
  p_thick: d.f32,
  p_view: d.f32,
  p_warp: d.f32,
  res: d.vec2f,
  time: d.f32,
});

const layout = tgpu
  .bindGroupLayout({ params: { uniform: nacreUniforms } })
  .$idx(0);

const rot2 = tgpu.fn(
  [d.f32],
  d.mat2x2f,
)((angle) => {
  "use gpu";
  const c = std.cos(angle);
  const s = std.sin(angle);
  return d.mat2x2f(d.vec2f(c, -s), d.vec2f(s, c));
});

/**
 * Guard: `abs` on the denominator is exact, not an approximation — the square
 * afterwards folds the sign away, and dropping the branch is the point.
 */
const cotBands = tgpu.fn(
  [d.vec3f, d.f32],
  d.vec3f,
)((x, k) => {
  "use gpu";
  const b = std.tanh(
    std
      .cos(x)
      .mul(k)
      .div(std.max(std.abs(std.sin(x)), d.vec3f(1e-4))),
  );
  return b.mul(b);
});

const nacreRender = tgpu.fn(
  [d.vec2f, d.f32, d.f32, d.f32],
  d.vec3f,
)((fragCoord, warp, thick, gain) => {
  "use gpu";
  const u = layout.$.params;
  const uv = fragCoord.mul(2).sub(u.res).div(std.min(u.res.x, u.res.y));
  const radius = std.max(u.p_radius, 0.001);
  const pl = uv.div(radius);
  const z = std.sqrt(std.max(1 - std.dot(pl, pl), 0));
  const n = d.vec3f(pl, z);
  const t = u.p_speed;

  let p = d.vec2f(n.xy.div(n.z + 1 + u.p_bulge).mul(u.p_scale));
  p = std.mul(rot2(u.p_swirl), p);
  p = d.vec2f(p.x, p.y - u.p_flow);

  let q = d.vec2f(p);
  for (const j of std.range(OCTAVES)) {
    const i = d.f32(j) + 1;
    q = q.add(
      std
        .sin(
          q.yx
            .mul(i)
            .add(i * i + t * i)
            .add(d.vec2f(4.7, 2.3)),
        )
        .mul(warp)
        .div(i),
    );
  }

  const band = cotBands(
    d.vec3f(q.y).add(d.vec3f(0, 1, 3).mul(u.p_split)),
    thick,
  );
  const lev = std.dot(band, d.vec3f(1 / 3));

  let col = u.c_deep.mul(u.p_floor);
  col = col.add(
    band
      .mul(std.mix(u.c_low, u.c_crest, std.smoothstep(0.1, 0.9, lev)))
      .mul(gain),
  );

  const irid = std
    .cos(
      d
        .vec3f(0, 0.33, 0.67)
        .add(q.y * u.p_irisScale + (1 - z) * u.p_view + t * 0.03)
        .mul(TAU),
    )
    .mul(0.5)
    .add(0.5);
  col = std.mix(col, col.mul(irid.mul(1.9).add(0.25)), u.p_iris);
  col = std.pow(std.max(col, d.vec3f()), d.vec3f(u.p_contrast));

  const lambert = std.clamp(
    std.dot(n, std.normalize(d.vec3f(-0.45, 0.55, 0.72))),
    0,
    1,
  );
  col = col.mul(0.35 + u.p_light * lambert);

  const fres = 1 - z;
  col = col.add(u.c_sheen.mul(u.p_rim * fres * fres * fres));

  return col;
});

const nacreFragment = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f,
  })((input) => {
    "use gpu";
    const u = layout.$.params;
    const fragCoord = input.uv.mul(u.res);
    const auraUv = fragCoord.mul(2).sub(u.res).div(std.min(u.res.x, u.res.y));

    /**
     * Guard: the beat swings the warp at `anim * 5`, well under 3Hz. It moves
     * the whole ball, and a full-field oscillation above 3Hz is inside the
     * range photosensitivity guidance warns about; raising the rate much past
     * 18 walks back into it.
     */
    const beat = 0.5 - 0.5 * std.cos(u.anim * 5);
    const warp = std.mix(
      u.p_warp * (1 + 0.45 * u.inputVol),
      std.mix(0.6, 1.8, beat),
      u.p_beat,
    );
    const thick = u.p_thick * (1 + 0.6 * u.outputVol);
    const gain = u.p_gain * (0.85 + 0.4 * u.outputVol);

    const mask = std.smoothstep(
      0.012,
      -0.012,
      std.length(auraUv) - std.max(u.p_radius, 0.001),
    );
    if (mask <= 0) {
      return d.vec4f();
    }

    const col = nacreRender(fragCoord, warp, thick, gain);

    return d.vec4f(std.max(col, d.vec3f()).mul(mask), mask);
  })
  .$name("nacreFragment");

/**
 * The Nacre aura as resolved WGSL. Shader by XorDev (https://x.com/XorDev),
 * ported by shadercn (https://github.com/shadcn-labs/shadercn) with the author's
 * permission: non-commercial use only, with attribution to XorDev. This notice
 * stays with the file.
 */
export const nacreShader = tgpu.resolve([nacreFragment]);
