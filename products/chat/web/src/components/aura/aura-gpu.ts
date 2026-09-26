import { createAuraScene } from "./aura-scene";
import type { AuraScheme, AuraState, AuraVariant } from "./aura-variant";

const FULLSCREEN_VERTEX = `
struct AuraVertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn aura_vertex(@builtin(vertex_index) vi: u32) -> AuraVertexOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uv = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var out: AuraVertexOut;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = uv[vi];
  return out;
}
`;

export interface AuraMountOptions {
  readonly canvas: HTMLCanvasElement;
  readonly variant: AuraVariant;
  readonly state: () => AuraState;
  readonly scheme: () => AuraScheme;
  readonly maxDpr: number;
  readonly onFirstFrame: () => void;
  readonly onFailure: () => void;
}

let sharedDevice: Promise<GPUDevice> | undefined;

const pipelines = new WeakMap<
  GPUDevice,
  Map<string, Promise<GPURenderPipeline>>
>();

/**
 * Guard: every aura on the page shares one device, so a remount skips the adapter
 * round trip and hits the pipeline cache instead of compiling the shader again.
 * The cached promise is dropped on loss or failure; without that one lost device
 * would leave every later aura on the page blank.
 */
function device(): Promise<GPUDevice> {
  if (sharedDevice !== undefined) {
    return sharedDevice;
  }
  const pending = (async () => {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "low-power",
    });
    if (adapter === null) {
      throw new Error("webgpu adapter unavailable");
    }
    const next = await adapter.requestDevice();
    void next.lost.then(() => {
      if (sharedDevice === pending) {
        sharedDevice = undefined;
      }
    });

    return next;
  })();
  sharedDevice = pending;
  void pending.catch(() => {
    if (sharedDevice === pending) {
      sharedDevice = undefined;
    }
  });

  return pending;
}

function pipeline(
  gpu: GPUDevice,
  variant: AuraVariant,
  format: GPUTextureFormat,
): Promise<GPURenderPipeline> {
  let byVariant = pipelines.get(gpu);
  if (byVariant === undefined) {
    byVariant = new Map();
    pipelines.set(gpu, byVariant);
  }
  const key = `${variant.key}:${format}`;
  const cached = byVariant.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const module = gpu.createShaderModule({
    label: variant.key,
    code: `${FULLSCREEN_VERTEX}${variant.shader}`,
  });
  const created = gpu.createRenderPipelineAsync({
    label: variant.key,
    layout: "auto",
    vertex: { module },
    fragment: { module, targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  byVariant.set(key, created);

  return created;
}

/**
 * Guard: the abort is checked after every await and before the context is
 * touched. A canvas has exactly one `GPUCanvasContext`, so a mount disposed
 * while waiting on the device — React's StrictMode does this to every effect —
 * would otherwise configure and then unconfigure the context its successor on
 * the same canvas is already drawing to, and the successor's next frame throws
 * "context is not configured".
 */
async function start(
  options: AuraMountOptions,
  signal: AbortSignal,
): Promise<void> {
  const { canvas, variant, state, scheme, maxDpr, onFirstFrame, onFailure } =
    options;
  const gpu = await device();
  if (signal.aborted) {
    return;
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  const render = await pipeline(gpu, variant, format);
  if (signal.aborted) {
    return;
  }
  const context = canvas.getContext("webgpu");
  if (context === null) {
    throw new Error("webgpu canvas context unavailable");
  }

  /**
   * Guard: the fragment writes colour already multiplied by its coverage mask,
   * so the canvas must composite as premultiplied. `opaque` paints the corners
   * black and `unpremultiplied` rims the silhouette with a dark fringe.
   */
  context.configure({ device: gpu, format, alphaMode: "premultiplied" });

  const scene = createAuraScene(variant, state(), scheme());
  const uniform = gpu.createBuffer({
    label: variant.key,
    size: scene.image.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = gpu.createBindGroup({
    layout: render.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniform } }],
  });

  const resize = () => {
    const dpr = Math.min(maxDpr, Math.max(1, window.devicePixelRatio));
    const limit = gpu.limits.maxTextureDimension2D;
    const width = Math.min(
      limit,
      Math.max(1, Math.round(canvas.clientWidth * dpr)),
    );
    const height = Math.min(
      limit,
      Math.max(1, Math.round(canvas.clientHeight * dpr)),
    );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    scene.resize(width, height);
  };
  resize();
  const resizer = new ResizeObserver(resize);
  resizer.observe(canvas);

  let visible = true;
  const watcher = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
  });
  watcher.observe(canvas);

  let stopped = false;
  let painted = false;
  let last: number | undefined;
  let handle = 0;

  const tick = (now: number) => {
    handle = requestAnimationFrame(tick);
    const dt = last === undefined ? 0 : (now - last) / 1000;
    last = now;
    if (!visible) {
      return;
    }
    scene.advance(dt, state(), scheme());
    gpu.queue.writeBuffer(uniform, 0, scene.image);
    const encoder = gpu.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    pass.setPipeline(render);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    gpu.queue.submit([encoder.finish()]);
    if (!painted) {
      painted = true;
      onFirstFrame();
    }
  };
  handle = requestAnimationFrame(tick);

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    cancelAnimationFrame(handle);
    resizer.disconnect();
    watcher.disconnect();
    context.unconfigure();
    uniform.destroy();
  };
  signal.addEventListener("abort", stop, { once: true });
  void gpu.lost.then(() => {
    if (!stopped) {
      stop();
      onFailure();
    }
  });
}

/**
 * Starts drawing one aura on `canvas` until the returned function is called.
 * Safe to dispose before the device arrives; a failure to start is reported
 * through `onFailure` and never thrown.
 * @param options The canvas, the variant, and a per-frame read of the state.
 * @returns Disposes the aura; idempotent.
 */
export function mountAura(options: AuraMountOptions): () => void {
  const controller = new AbortController();
  void start(options, controller.signal).catch(() => {
    if (!controller.signal.aborted) {
      options.onFailure();
    }
  });

  return () => controller.abort();
}
