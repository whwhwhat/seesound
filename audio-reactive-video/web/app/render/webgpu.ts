import {
  BASE_BG_COLOR,
  atmosphereEnabledInput,
  fieldGeometry,
  fieldSize,
  numericControls,
  state,
  wgpuCanvas,
} from "../state/context";
import {
  clamp,
  lerpColor,
} from "../core/utils";
import {
  percentileOfField,
} from "../core/geometry";
import BACKGROUND_SHADER from "../shaders/wgsl/background.wgsl?raw";
import BLUR_SHADER from "../shaders/wgsl/blur.wgsl?raw";
import CONTOUR_COMPUTE_SHADER from "../shaders/wgsl/contour-compute.wgsl?raw";
import FIELD_SHADER from "../shaders/wgsl/field.wgsl?raw";
import FULLSCREEN_VERTEX_SHADER from "../shaders/wgsl/fullscreen-vertex.wgsl?raw";
import PERCENTILE_HISTOGRAM_SHADER from "../shaders/wgsl/percentile-histogram.wgsl?raw";
import PERCENTILE_MAX_SHADER from "../shaders/wgsl/percentile-max.wgsl?raw";
import PERCENTILE_RESOLVE_SHADER from "../shaders/wgsl/percentile-resolve.wgsl?raw";
import REDUCE_SHADER from "../shaders/wgsl/reduce.wgsl?raw";
import SEGMENT_RENDER_SHADER from "../shaders/wgsl/segment-render.wgsl?raw";
import type {
  InitializedWebGpuState,
  ModeRenderState,
  SpatialAtlasCache,
  WebGpuFrameProfileTools,
  WebGpuReductionTarget,
  WebGpuRenderParams,
  WebGpuState,
  RGBColor,
  ThemeGlowPalette,
} from "../types";
import {
  profiler,
} from "../state/runtime-state";

const MAX_MODES = 48;
const FIELD_STRIDE = fieldSize - 1;
const MAX_CONTOUR_SEGMENTS = FIELD_STRIDE * FIELD_STRIDE * 2;
const SEGMENT_STRIDE_BYTES = 32;
const PERCENTILE_BIN_COUNT = 4096;
const PERCENTILE_DEBUG_INTERVAL = 45;
const WEBGPU_FIELD_FORMAT = "rgba16float";
const WEBGPU_ATLAS_FORMAT = "r32float";
const WEBGPU_DITHER_FORMAT = "r32float";
const PRESENTATION_SUPERSAMPLE = 2;
const PRESENTATION_MAX_SIZE = 2048;
const percentileDebugFieldScratch = new Float32Array(fieldSize * fieldSize);

const webGpuState: WebGpuState = {
  adapter: null,
  device: null,
  context: null,
  canvasFormat: "",
  ready: false,
  failed: false,
  initPromise: null,
  currentCanvasSize: "",
  uploadedAtlasKey: "",
  fieldPipeline: null,
  reducePipeline: null,
  percentileMaxPipeline: null,
  percentileHistogramPipeline: null,
  percentileResolvePipeline: null,
  backgroundPipeline: null,
  contourPipeline: null,
  linePipeline: null,
  lineUnionPipeline: null,
  blurPipeline: null,
  sharpAtlasTexture: null,
  blurredAtlasTexture: null,
  ditherTexture: null,
  fieldTexture: null,
  fieldView: null,
  colorAccumTexture: null,
  colorAccumView: null,
  colorWeightTexture: null,
  colorWeightView: null,
  reductionChain: [],
  modeStateBuffer: null,
  fieldParamsBuffer: null,
  reduceParamsBuffer: null,
  percentileParamsBuffer: null,
  percentileHistogramBuffer: null,
  percentileResultBuffer: null,
  percentileMaxFieldBuffer: null,
  percentileDebugBuffer: null,
  percentileDebugPending: false,
  percentileDebugFrame: 0,
  backgroundParamsBuffer: null,
  contourParamsBuffer: null,
  lineParamsBuffers: [],
  blurParamsBuffers: [],
  segmentBuffer: null,
  glowSourceTexture: null,
  glowSourceView: null,
  glowBlurTexture: null,
  glowBlurView: null,
  glowTargetWidth: 0,
  glowTargetHeight: 0,
  linearSampler: null,
  dirtyContextConfig: true,
};

function requireWebGpuDevice(): GPUDevice {
  if (!webGpuState.device) {
    throw new Error("WebGPU device is unavailable");
  }
  return webGpuState.device;
}

function requireWebGpuContext(): GPUCanvasContext {
  if (!webGpuState.context) {
    throw new Error("WebGPU canvas context is unavailable");
  }
  return webGpuState.context;
}

function requireInitializedWebGpuState(): InitializedWebGpuState {
  if (
    !webGpuState.adapter ||
    !webGpuState.device ||
    !webGpuState.context ||
    !webGpuState.fieldPipeline ||
    !webGpuState.reducePipeline ||
    !webGpuState.percentileMaxPipeline ||
    !webGpuState.percentileHistogramPipeline ||
    !webGpuState.percentileResolvePipeline ||
    !webGpuState.backgroundPipeline ||
    !webGpuState.contourPipeline ||
    !webGpuState.linePipeline ||
    !webGpuState.lineUnionPipeline ||
    !webGpuState.blurPipeline ||
    !webGpuState.sharpAtlasTexture ||
    !webGpuState.blurredAtlasTexture ||
    !webGpuState.ditherTexture ||
    !webGpuState.fieldTexture ||
    !webGpuState.fieldView ||
    !webGpuState.colorAccumTexture ||
    !webGpuState.colorAccumView ||
    !webGpuState.colorWeightTexture ||
    !webGpuState.colorWeightView ||
    !webGpuState.modeStateBuffer ||
    !webGpuState.fieldParamsBuffer ||
    !webGpuState.reduceParamsBuffer ||
    !webGpuState.percentileParamsBuffer ||
    !webGpuState.percentileHistogramBuffer ||
    !webGpuState.percentileResultBuffer ||
    !webGpuState.percentileMaxFieldBuffer ||
    !webGpuState.percentileDebugBuffer ||
    !webGpuState.backgroundParamsBuffer ||
    !webGpuState.contourParamsBuffer ||
    !webGpuState.segmentBuffer ||
    !webGpuState.glowSourceTexture ||
    !webGpuState.glowSourceView ||
    !webGpuState.glowBlurTexture ||
    !webGpuState.glowBlurView ||
    !webGpuState.linearSampler
  ) {
    throw new Error("WebGPU state is not fully initialized");
  }
  return webGpuState as InitializedWebGpuState;
}

function isWebGpuSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.gpu) && Boolean(wgpuCanvas);
}

function setWebGpuCanvasVisible(visible: boolean, rotateCircleSigned = false): void {
  if (!wgpuCanvas) {
    return;
  }
  wgpuCanvas.classList.toggle("is-visible", visible);
  wgpuCanvas.style.transform = rotateCircleSigned ? "rotate(-90deg)" : "";
}

function handleWebGpuResize(): void {
  webGpuState.dirtyContextConfig = true;
}

function clearWebGpuPresentation(): void {
  setWebGpuCanvasVisible(false, false);
}

function createShaderModule(code: string): GPUShaderModule {
  return requireWebGpuDevice().createShaderModule({ code });
}

function createFieldTextures(): void {
  const device = requireWebGpuDevice();
  webGpuState.fieldTexture = device.createTexture({
    size: [fieldSize, fieldSize],
    format: WEBGPU_FIELD_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  webGpuState.fieldView = webGpuState.fieldTexture.createView();

  webGpuState.colorAccumTexture = device.createTexture({
    size: [fieldSize, fieldSize],
    format: WEBGPU_FIELD_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  webGpuState.colorAccumView = webGpuState.colorAccumTexture.createView();

  webGpuState.colorWeightTexture = device.createTexture({
    size: [fieldSize, fieldSize],
    format: WEBGPU_FIELD_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  webGpuState.colorWeightView = webGpuState.colorWeightTexture.createView();
}

function createPresentationTextures(): void {
  const device = requireWebGpuDevice();
  const targetWidth = Math.min(PRESENTATION_MAX_SIZE, Math.max(1, Math.round(wgpuCanvas.width * PRESENTATION_SUPERSAMPLE)));
  const targetHeight = Math.min(PRESENTATION_MAX_SIZE, Math.max(1, Math.round(wgpuCanvas.height * PRESENTATION_SUPERSAMPLE)));
  webGpuState.glowTargetWidth = targetWidth;
  webGpuState.glowTargetHeight = targetHeight;
  webGpuState.glowSourceTexture = device.createTexture({
    size: [targetWidth, targetHeight],
    format: webGpuState.canvasFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  webGpuState.glowSourceView = webGpuState.glowSourceTexture.createView();

  webGpuState.glowBlurTexture = device.createTexture({
    size: [targetWidth, targetHeight],
    format: webGpuState.canvasFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  webGpuState.glowBlurView = webGpuState.glowBlurTexture.createView();
}

function buildReductionChain(): void {
  const device = requireWebGpuDevice();
  const chain: WebGpuReductionTarget[] = [];
  let width = fieldSize;
  let height = fieldSize;
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.ceil(width / 2));
    height = Math.max(1, Math.ceil(height / 2));
    const texture = device.createTexture({
      size: [width, height],
      format: WEBGPU_FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    chain.push({
      width,
      height,
      texture,
      view: texture.createView(),
    });
  }
  webGpuState.reductionChain = chain;
}

function createStaticTextures(): void {
  const device = requireWebGpuDevice();
  webGpuState.sharpAtlasTexture = device.createTexture({
    size: [fieldSize, fieldSize, MAX_MODES],
    format: WEBGPU_ATLAS_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  webGpuState.blurredAtlasTexture = device.createTexture({
    size: [fieldSize, fieldSize, MAX_MODES],
    format: WEBGPU_ATLAS_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  webGpuState.ditherTexture = device.createTexture({
    size: [fieldSize, fieldSize],
    format: WEBGPU_DITHER_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  webGpuState.modeStateBuffer = device.createBuffer({
    size: MAX_MODES * 8 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  webGpuState.fieldParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  webGpuState.reduceParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  webGpuState.percentileParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  webGpuState.percentileHistogramBuffer = device.createBuffer({
    size: (PERCENTILE_BIN_COUNT + 1) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  webGpuState.percentileResultBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  webGpuState.percentileMaxFieldBuffer = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  webGpuState.percentileDebugBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  webGpuState.backgroundParamsBuffer = device.createBuffer({
    size: 9 * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  webGpuState.contourParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  webGpuState.lineParamsBuffers = Array.from({ length: 4 }, () => device.createBuffer({
    size: 4 * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }));
  webGpuState.blurParamsBuffers = Array.from({ length: 5 }, () => device.createBuffer({
    size: 2 * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }));
  webGpuState.segmentBuffer = device.createBuffer({
    size: MAX_CONTOUR_SEGMENTS * SEGMENT_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE,
  });
  webGpuState.linearSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
}

function createPipelines(): void {
  const device = requireWebGpuDevice();
  const fullscreenVertexModule = createShaderModule(FULLSCREEN_VERTEX_SHADER);
  const fieldModule = createShaderModule(FIELD_SHADER);
  const reduceModule = createShaderModule(REDUCE_SHADER);
  const percentileMaxModule = createShaderModule(PERCENTILE_MAX_SHADER);
  const percentileHistogramModule = createShaderModule(PERCENTILE_HISTOGRAM_SHADER);
  const percentileResolveModule = createShaderModule(PERCENTILE_RESOLVE_SHADER);
  const backgroundModule = createShaderModule(BACKGROUND_SHADER);
  const contourModule = createShaderModule(CONTOUR_COMPUTE_SHADER);
  const segmentModule = createShaderModule(SEGMENT_RENDER_SHADER);
  const blurModule = createShaderModule(BLUR_SHADER);

  webGpuState.fieldPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: fullscreenVertexModule,
      entryPoint: "main",
    },
    fragment: {
      module: fieldModule,
      entryPoint: "main",
      targets: [
        { format: WEBGPU_FIELD_FORMAT },
        { format: WEBGPU_FIELD_FORMAT },
        { format: WEBGPU_FIELD_FORMAT },
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  webGpuState.reducePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: fullscreenVertexModule,
      entryPoint: "main",
    },
    fragment: {
      module: reduceModule,
      entryPoint: "main",
      targets: [{ format: WEBGPU_FIELD_FORMAT }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  webGpuState.backgroundPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: fullscreenVertexModule,
      entryPoint: "main",
    },
    fragment: {
      module: backgroundModule,
      entryPoint: "main",
      targets: [{ format: webGpuState.canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  webGpuState.percentileMaxPipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: percentileMaxModule,
      entryPoint: "main",
    },
  });

  webGpuState.percentileHistogramPipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: percentileHistogramModule,
      entryPoint: "main",
    },
  });

  webGpuState.percentileResolvePipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: percentileResolveModule,
      entryPoint: "main",
    },
  });

  webGpuState.contourPipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: contourModule,
      entryPoint: "main",
    },
  });

  webGpuState.linePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: segmentModule,
      entryPoint: "vsMain",
    },
    fragment: {
      module: segmentModule,
      entryPoint: "fsMain",
      targets: [
        {
          format: webGpuState.canvasFormat,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  webGpuState.lineUnionPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: segmentModule,
      entryPoint: "vsMain",
    },
    fragment: {
      module: segmentModule,
      entryPoint: "fsMain",
      targets: [
        {
          format: webGpuState.canvasFormat,
          blend: {
            color: {
              srcFactor: "one",
              dstFactor: "one",
              operation: "max",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one",
              operation: "max",
            },
          },
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  webGpuState.blurPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: blurModule,
      entryPoint: "vsMain",
    },
    fragment: {
      module: blurModule,
      entryPoint: "fsMain",
      targets: [
        {
          format: webGpuState.canvasFormat,
          blend: {
            color: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
}

function uploadDitherTexture(): void {
  requireWebGpuDevice().queue.writeTexture(
    { texture: webGpuState.ditherTexture },
    fieldGeometry.dither,
    {
      offset: 0,
      bytesPerRow: fieldSize * 4,
      rowsPerImage: fieldSize,
    },
    {
      width: fieldSize,
      height: fieldSize,
    },
  );
}

function ensureCanvasConfigured(): boolean {
  if (!webGpuState.ready || !webGpuState.context) {
    return false;
  }
  const sizeKey = `${wgpuCanvas.width}x${wgpuCanvas.height}`;
  if (!webGpuState.dirtyContextConfig && webGpuState.currentCanvasSize === sizeKey) {
    return true;
  }
  requireWebGpuContext().configure({
    device: requireWebGpuDevice(),
    format: webGpuState.canvasFormat,
    alphaMode: "opaque",
  });
  createPresentationTextures();
  webGpuState.currentCanvasSize = sizeKey;
  webGpuState.dirtyContextConfig = false;
  return true;
}

async function primeWebGpuRenderer(): Promise<boolean> {
  if (webGpuState.ready) {
    return true;
  }
  if (webGpuState.failed) {
    return false;
  }
  if (webGpuState.initPromise) {
    return webGpuState.initPromise;
  }
  if (!isWebGpuSupported()) {
    webGpuState.failed = true;
    return false;
  }

  webGpuState.initPromise = (async () => {
    try {
      const gpu = navigator.gpu;
      if (!gpu) {
        throw new Error("WebGPU is unavailable");
      }
      webGpuState.adapter = await gpu.requestAdapter();
      if (!webGpuState.adapter) {
        throw new Error("No WebGPU adapter available");
      }
      webGpuState.device = await webGpuState.adapter.requestDevice();
      webGpuState.context = wgpuCanvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!webGpuState.context) {
        throw new Error("WebGPU canvas context unavailable");
      }
      webGpuState.canvasFormat = gpu.getPreferredCanvasFormat?.() ?? "bgra8unorm";
      createStaticTextures();
      createFieldTextures();
      buildReductionChain();
      createPipelines();
      uploadDitherTexture();
      ensureCanvasConfigured();
      webGpuState.ready = true;
      return true;
    } catch (error) {
      console.warn("WebGPU renderer unavailable", error);
      webGpuState.failed = true;
      clearWebGpuPresentation();
      return false;
    }
  })();

  return webGpuState.initPromise;
}

function uploadSpatialAtlas(spatialAtlas: SpatialAtlasCache): void {
  const readyState = requireInitializedWebGpuState();
  if (webGpuState.uploadedAtlasKey === spatialAtlas.key) {
    return;
  }
  const uploadExtent = {
    width: fieldSize,
    height: fieldSize,
    depthOrArrayLayers: spatialAtlas.modeCount,
  };
  requireWebGpuDevice().queue.writeTexture(
    { texture: readyState.sharpAtlasTexture },
    spatialAtlas.sharp,
    {
      offset: 0,
      bytesPerRow: fieldSize * 4,
      rowsPerImage: fieldSize,
    },
    uploadExtent,
  );
  requireWebGpuDevice().queue.writeTexture(
    { texture: readyState.blurredAtlasTexture },
    spatialAtlas.blurred,
    {
      offset: 0,
      bytesPerRow: fieldSize * 4,
      rowsPerImage: fieldSize,
    },
    uploadExtent,
  );
  webGpuState.uploadedAtlasKey = spatialAtlas.key;
}

function uploadModeState(modeRenderState: ModeRenderState): void {
  const readyState = requireInitializedWebGpuState();
  const packed = new Float32Array(MAX_MODES * 8);
  for (let index = 0; index < state.modeState.length; index += 1) {
    const offset = index * 8;
    packed[offset] = modeRenderState.enabled[index];
    packed[offset + 1] = modeRenderState.contribution[index];
    packed[offset + 2] = modeRenderState.sharpMix[index];
    packed[offset + 3] = modeRenderState.blurMix[index];
    packed[offset + 4] = modeRenderState.color[index * 3];
    packed[offset + 5] = modeRenderState.color[index * 3 + 1];
    packed[offset + 6] = modeRenderState.color[index * 3 + 2];
    packed[offset + 7] = 0;
  }
  requireWebGpuDevice().queue.writeBuffer(readyState.modeStateBuffer, 0, packed);
}

function encodeFieldPass(
  encoder: GPUCommandEncoder,
  spatialAtlas: SpatialAtlasCache,
  modeRenderState: ModeRenderState,
  isSingleMode: boolean,
  useGlowColor: boolean,
): void {
  const readyState = requireInitializedWebGpuState();
  uploadSpatialAtlas(spatialAtlas);
  uploadModeState(modeRenderState);
  requireWebGpuDevice().queue.writeBuffer(
    readyState.fieldParamsBuffer,
    0,
    new Uint32Array([
      state.modeState.length,
      isSingleMode ? 1 : 0,
      state.combineMode === "signed" ? 1 : 0,
      useGlowColor ? 1 : 0,
    ]),
  );

  const device = requireWebGpuDevice();
  const bindGroup = device.createBindGroup({
    layout: readyState.fieldPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: readyState.sharpAtlasTexture.createView({ dimension: "2d-array", arrayLayerCount: MAX_MODES }) },
      { binding: 1, resource: readyState.blurredAtlasTexture.createView({ dimension: "2d-array", arrayLayerCount: MAX_MODES }) },
      { binding: 2, resource: { buffer: readyState.modeStateBuffer } },
      { binding: 3, resource: { buffer: readyState.fieldParamsBuffer } },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: readyState.fieldView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
      {
        view: readyState.colorAccumView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
      {
        view: readyState.colorWeightView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(readyState.fieldPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
}

function encodeReductionPasses(encoder: GPUCommandEncoder): void {
  const readyState = requireInitializedWebGpuState();
  let sourceView = readyState.fieldView;
  let sourceWidth = fieldSize;
  let sourceHeight = fieldSize;

  for (const target of webGpuState.reductionChain) {
    requireWebGpuDevice().queue.writeBuffer(
      readyState.reduceParamsBuffer,
      0,
      new Uint32Array([sourceWidth, sourceHeight, 0, 0]),
    );
    const bindGroup = requireWebGpuDevice().createBindGroup({
      layout: readyState.reducePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: { buffer: readyState.reduceParamsBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(readyState.reducePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
    sourceView = target.view;
    sourceWidth = target.width;
    sourceHeight = target.height;
  }
}

function writePercentileParams(active: boolean): void {
  const readyState = requireInitializedWebGpuState();
  const packed = new ArrayBuffer(16);
  const view = new DataView(packed);
  view.setFloat32(0, state.plateShape === "circle" ? 0.74 : 0.7, true);
  view.setUint32(4, active ? 1 : 0, true);
  view.setUint32(8, state.plateShape === "circle" ? 1 : 0, true);
  view.setUint32(12, 0, true);
  requireWebGpuDevice().queue.writeBuffer(readyState.percentileParamsBuffer, 0, packed);
}

function computeCpuPercentileMetrics(
  spatialAtlas: SpatialAtlasCache,
  modeRenderState: ModeRenderState,
): { threshold: number; displayScale: number } {
  percentileDebugFieldScratch.fill(0);
  const fieldCellCount = percentileDebugFieldScratch.length;
  for (let index = 0; index < state.modeState.length; index += 1) {
    if (modeRenderState.enabled[index] === 0) {
      continue;
    }
    const contribution = modeRenderState.contribution[index];
    const sharpMix = modeRenderState.sharpMix[index];
    const blurMix = modeRenderState.blurMix[index];
    const atlasOffset = index * fieldCellCount;
    for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
      const spatialValue =
        spatialAtlas.sharp[atlasOffset + ptr] * sharpMix +
        spatialAtlas.blurred[atlasOffset + ptr] * blurMix;
      percentileDebugFieldScratch[ptr] += Math.abs(spatialValue * contribution);
    }
  }

  const threshold = percentileOfField(
    percentileDebugFieldScratch,
    state.plateShape === "circle" ? 0.74 : 0.7,
    state.plateShape === "circle",
  );
  let displayScale = 1e-6;
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    if (state.plateShape === "circle" && fieldGeometry.circleInteriorMask[ptr] === 0) {
      continue;
    }
    displayScale = Math.max(displayScale, Math.abs(percentileDebugFieldScratch[ptr] - threshold));
  }
  return {
    threshold,
    displayScale,
  };
}

function schedulePercentileDebugReadback(
  readyState: InitializedWebGpuState,
  cpuMetrics: { threshold: number; displayScale: number },
): void {
  if (webGpuState.percentileDebugPending) {
    return;
  }
  webGpuState.percentileDebugPending = true;
  void readyState.percentileDebugBuffer.mapAsync(GPUMapMode.READ).then(() => {
    try {
      const values = new Float32Array(readyState.percentileDebugBuffer.getMappedRange().slice(0));
      console.info(
        "[percentile-debug]",
        JSON.stringify({
          shape: state.plateShape,
          cpuThreshold: Number(cpuMetrics.threshold.toFixed(6)),
          gpuThreshold: Number((values[0] ?? 0).toFixed(6)),
          cpuDisplayScale: Number(cpuMetrics.displayScale.toFixed(6)),
          gpuDisplayScale: Number((values[1] ?? 0).toFixed(6)),
          gpuEnabled: Number((values[2] ?? 0).toFixed(3)),
          gpuMaxField: Number((values[3] ?? 0).toFixed(6)),
          diffThreshold: Number(Math.abs((values[0] ?? 0) - cpuMetrics.threshold).toFixed(6)),
        }),
      );
    } finally {
      readyState.percentileDebugBuffer.unmap();
      webGpuState.percentileDebugPending = false;
    }
  }).catch((error) => {
    console.warn("Percentile debug readback failed", error);
    webGpuState.percentileDebugPending = false;
  });
}

function encodePercentilePasses(encoder: GPUCommandEncoder, enabled: boolean): void {
  const readyState = requireInitializedWebGpuState();

  writePercentileParams(enabled);
  requireWebGpuDevice().queue.writeBuffer(
    readyState.percentileHistogramBuffer,
    0,
    new Uint32Array(PERCENTILE_BIN_COUNT + 1),
  );
  requireWebGpuDevice().queue.writeBuffer(
    readyState.percentileResultBuffer,
    0,
    new Float32Array([0, 1, 0, 0]),
  );
  requireWebGpuDevice().queue.writeBuffer(
    readyState.percentileMaxFieldBuffer,
    0,
    new Uint32Array([0, 0, 0, 0]),
  );

  if (enabled) {
    const maxBindGroup = requireWebGpuDevice().createBindGroup({
      layout: readyState.percentileMaxPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: readyState.fieldView },
        { binding: 1, resource: { buffer: readyState.percentileParamsBuffer } },
        { binding: 2, resource: { buffer: readyState.percentileMaxFieldBuffer } },
      ],
    });
    const maxPass = encoder.beginComputePass();
    maxPass.setPipeline(readyState.percentileMaxPipeline);
    maxPass.setBindGroup(0, maxBindGroup);
    maxPass.dispatchWorkgroups(Math.ceil(fieldSize / 8), Math.ceil(fieldSize / 8), 1);
    maxPass.end();

    const histogramBindGroup = requireWebGpuDevice().createBindGroup({
      layout: readyState.percentileHistogramPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: readyState.fieldView },
        { binding: 1, resource: { buffer: readyState.percentileMaxFieldBuffer } },
        { binding: 2, resource: { buffer: readyState.percentileParamsBuffer } },
        { binding: 3, resource: { buffer: readyState.percentileHistogramBuffer } },
      ],
    });
    const histogramPass = encoder.beginComputePass();
    histogramPass.setPipeline(readyState.percentileHistogramPipeline);
    histogramPass.setBindGroup(0, histogramBindGroup);
    histogramPass.dispatchWorkgroups(Math.ceil(fieldSize / 8), Math.ceil(fieldSize / 8), 1);
    histogramPass.end();
  }

  const resolveBindGroup = requireWebGpuDevice().createBindGroup({
    layout: readyState.percentileResolvePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: readyState.percentileMaxFieldBuffer } },
      { binding: 1, resource: { buffer: readyState.percentileParamsBuffer } },
      { binding: 2, resource: { buffer: readyState.percentileHistogramBuffer } },
      { binding: 3, resource: { buffer: readyState.percentileResultBuffer } },
    ],
  });
  const resolvePass = encoder.beginComputePass();
  resolvePass.setPipeline(readyState.percentileResolvePipeline);
  resolvePass.setBindGroup(0, resolveBindGroup);
  resolvePass.dispatchWorkgroups(1, 1, 1);
  resolvePass.end();
}

function encodeContourPass(encoder: GPUCommandEncoder): void {
  const readyState = requireInitializedWebGpuState();
  requireWebGpuDevice().queue.writeBuffer(
    readyState.contourParamsBuffer,
    0,
    new Uint32Array([state.plateShape === "circle" ? 1 : 0, 0, 0, 0]),
  );
  const bindGroup = requireWebGpuDevice().createBindGroup({
    layout: readyState.contourPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: readyState.fieldView },
      { binding: 1, resource: { buffer: readyState.segmentBuffer } },
      { binding: 2, resource: { buffer: readyState.contourParamsBuffer } },
      { binding: 3, resource: { buffer: readyState.percentileResultBuffer } },
    ],
  });
  const pass = encoder.beginComputePass();
  pass.setPipeline(readyState.contourPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(FIELD_STRIDE / 8), Math.ceil(FIELD_STRIDE / 8), 1);
  pass.end();
}

function encodeBackgroundPass(encoder: GPUCommandEncoder, targetView: GPUTextureView, params: WebGpuRenderParams): void {
  const readyState = requireInitializedWebGpuState();
  const reductionView = webGpuState.reductionChain[webGpuState.reductionChain.length - 1]?.view ?? readyState.fieldView;
  const backgroundParams = new Float32Array([
    wgpuCanvas.width, wgpuCanvas.height, params.centroid, params.rms,
    params.haloSharpness, params.backgroundWeight, params.contrast, params.singleAmpGate,
    params.isSingleMode ? 1 : 0, state.plateShape === "circle" ? 1 : 0, atmosphereEnabledInput.checked ? 1 : 0, params.renderAsDormantField ? 1 : 0,
    BASE_BG_COLOR[0], BASE_BG_COLOR[1], BASE_BG_COLOR[2], 0,
    params.themePalette.backdropColor[0], params.themePalette.backdropColor[1], params.themePalette.backdropColor[2], 0,
    params.themePalette.baseColor[0], params.themePalette.baseColor[1], params.themePalette.baseColor[2], 0,
    params.themePalette.outerColor[0], params.themePalette.outerColor[1], params.themePalette.outerColor[2], 0,
    params.themePalette.atmosphereCore[0], params.themePalette.atmosphereCore[1], params.themePalette.atmosphereCore[2], 0,
    params.themePalette.atmosphereOuter[0], params.themePalette.atmosphereOuter[1], params.themePalette.atmosphereOuter[2], 0,
  ]);
  requireWebGpuDevice().queue.writeBuffer(readyState.backgroundParamsBuffer, 0, backgroundParams);

  const bindGroup = requireWebGpuDevice().createBindGroup({
    layout: readyState.backgroundPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: readyState.fieldView },
      { binding: 1, resource: readyState.colorAccumView },
      { binding: 2, resource: readyState.colorWeightView },
      { binding: 3, resource: reductionView },
      { binding: 4, resource: readyState.ditherTexture.createView() },
      { binding: 5, resource: { buffer: readyState.backgroundParamsBuffer } },
      { binding: 6, resource: { buffer: readyState.percentileResultBuffer } },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: targetView,
        clearValue: {
          r: BASE_BG_COLOR[0] / 255,
          g: BASE_BG_COLOR[1] / 255,
          b: BASE_BG_COLOR[2] / 255,
          a: 1,
        },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(readyState.backgroundPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
}

function buildTargetMetrics(targetWidth: number, targetHeight: number) {
  const inset = targetWidth * 0.09;
  return {
    width: targetWidth,
    height: targetHeight,
    inset,
    drawSize: targetWidth - inset * 2,
    scale: targetWidth / Math.max(1, wgpuCanvas.width),
  };
}

function encodeLinePass(
  encoder: GPUCommandEncoder,
  targetView: GPUTextureView,
  metrics: { width: number; height: number; inset: number; drawSize: number; scale: number },
  bufferIndex: number,
  color: RGBColor,
  lineWidth: number,
  blurRadius: number,
  alpha: number,
  crisp: boolean,
  loadOp = "load",
  pipeline?: GPURenderPipeline,
): void {
  const readyState = requireInitializedWebGpuState();
  const resolvedPipeline = pipeline ?? readyState.linePipeline;
  const lineParamsBuffer = webGpuState.lineParamsBuffers[bufferIndex];
  const lineParams = new Float32Array([
    metrics.width, metrics.height, metrics.inset, metrics.drawSize,
    lineWidth * metrics.scale, blurRadius * metrics.scale, alpha, 0,
    color[0], color[1], color[2], 0,
    state.plateShape === "circle" ? 1 : 0, crisp ? 1 : 0, 0, 0,
  ]);
  requireWebGpuDevice().queue.writeBuffer(lineParamsBuffer, 0, lineParams);

  const bindGroup = requireWebGpuDevice().createBindGroup({
    layout: resolvedPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: readyState.segmentBuffer } },
      { binding: 1, resource: { buffer: lineParamsBuffer } },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp,
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(resolvedPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6, MAX_CONTOUR_SEGMENTS, 0, 0);
  pass.end();
}

function encodeBlurPass(
  encoder: GPUCommandEncoder,
  sourceView: GPUTextureView,
  targetView: GPUTextureView,
  sourceWidth: number,
  sourceHeight: number,
  bufferIndex: number,
  direction: [number, number],
  sigma: number,
  opacity: number,
  loadOp = "load",
): void {
  const readyState = requireInitializedWebGpuState();
  const blurParamsBuffer = webGpuState.blurParamsBuffers[bufferIndex];
  const resolvedSigma = Math.max(sigma * 0.68, 0.18);
  const blurParams = new Float32Array([
    sourceWidth, sourceHeight, 0, 0,
    direction[0], direction[1], resolvedSigma, opacity,
  ]);
  requireWebGpuDevice().queue.writeBuffer(blurParamsBuffer, 0, blurParams);

  const bindGroup = requireWebGpuDevice().createBindGroup({
    layout: readyState.blurPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: readyState.linearSampler },
      { binding: 1, resource: sourceView },
      { binding: 2, resource: { buffer: blurParamsBuffer } },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp,
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(readyState.blurPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
}

function renderGlowContours(encoder: GPUCommandEncoder, targetView: GPUTextureView, params: WebGpuRenderParams): void {
  const readyState = requireInitializedWebGpuState();
  const alpha = Math.max(0.1, params.singleAmpGate);
  const thickness = numericControls.glowThickness;
  const spread = numericControls.glowSpread;
  const intensity = numericControls.glowIntensity * 1.2;
  const separation = numericControls.colorSeparation;
  const glowSpread = Math.pow(spread, 0.7);
  const glowAlphaScale = 1 / Math.pow(thickness, 0.18);
  const offscreenMetrics = buildTargetMetrics(webGpuState.glowTargetWidth, webGpuState.glowTargetHeight);
  const outerGlowColor = lerpColor(params.themePalette.outerColor, params.glowColor, clamp(0.72 + separation * 0.12, 0, 1));
  const innerGlowColor = lerpColor(params.themePalette.baseColor, params.glowColor, clamp(0.9 + separation * 0.08, 0, 1));
  const lineColor = lerpColor(params.themePalette.baseColor, params.glowColor, 1);
  const outerCompositeOpacity = 0.60 * intensity;
  const innerCompositeOpacity = 0.54 * intensity;
  const outerLineWidth = (10 + alpha * 8) * (0.9 + thickness * 0.42);
  const innerLineWidth = (4.4 + alpha * 2.4) * (0.92 + thickness * 0.32);
  const crispLineWidth = (2.4 + alpha * 1.6) * (0.8 + thickness * 0.34) * 0.92;
  const outerBlur = (12 + alpha * 12) * glowSpread;
  const innerBlur = (3.5 + alpha * 3.2) * glowSpread;
  const outerAlpha = (0.08 + alpha * 0.09) * glowAlphaScale * 1.02 * intensity;
  const innerAlpha = (0.10 + alpha * 0.11) * glowAlphaScale * 0.94 * intensity;

  encodeLinePass(
    encoder,
    readyState.glowSourceView,
    offscreenMetrics,
    0,
    outerGlowColor,
    outerLineWidth,
    0,
    outerAlpha,
    true,
    "clear",
    readyState.lineUnionPipeline,
  );
  encodeBlurPass(encoder, readyState.glowSourceView, readyState.glowBlurView, webGpuState.glowTargetWidth, webGpuState.glowTargetHeight, 0, [1, 0], outerBlur * offscreenMetrics.scale, 1, "clear");
  encodeBlurPass(encoder, readyState.glowBlurView, targetView, webGpuState.glowTargetWidth, webGpuState.glowTargetHeight, 1, [0, 1], outerBlur * offscreenMetrics.scale, outerCompositeOpacity, "load");

  encodeLinePass(
    encoder,
    readyState.glowSourceView,
    offscreenMetrics,
    1,
    innerGlowColor,
    innerLineWidth,
    0,
    innerAlpha,
    true,
    "clear",
    readyState.lineUnionPipeline,
  );
  encodeBlurPass(encoder, readyState.glowSourceView, readyState.glowBlurView, webGpuState.glowTargetWidth, webGpuState.glowTargetHeight, 2, [1, 0], innerBlur * offscreenMetrics.scale, 1, "clear");
  encodeBlurPass(encoder, readyState.glowBlurView, targetView, webGpuState.glowTargetWidth, webGpuState.glowTargetHeight, 3, [0, 1], innerBlur * offscreenMetrics.scale, innerCompositeOpacity, "load");

  encodeLinePass(
    encoder,
    readyState.glowSourceView,
    offscreenMetrics,
    2,
    lineColor,
    crispLineWidth,
    0,
    (0.32 + alpha * 0.34) * 1.15,
    true,
    "clear",
    readyState.lineUnionPipeline,
  );
  encodeBlurPass(encoder, readyState.glowSourceView, targetView, webGpuState.glowTargetWidth, webGpuState.glowTargetHeight, 4, [0, 0], 0.001, 1, "load");
}

function renderIsolineContours(encoder: GPUCommandEncoder, targetView: GPUTextureView, params: WebGpuRenderParams): void {
  const readyState = requireInitializedWebGpuState();
  const thresholdAlpha = Math.max(0.12, params.singleAmpGate);
  const lineColor = params.themePalette.lineColor;
  const offscreenMetrics = buildTargetMetrics(webGpuState.glowTargetWidth, webGpuState.glowTargetHeight);
  const lineWidth = 1.28 + thresholdAlpha * 0.98;
  const lineOpacity = 0.40 + thresholdAlpha * 0.52;

  encodeLinePass(
    encoder,
    readyState.glowSourceView,
    offscreenMetrics,
    0,
    lineColor,
    lineWidth,
    0,
    lineOpacity,
    true,
    "clear",
    readyState.lineUnionPipeline,
  );
  encodeBlurPass(
    encoder,
    readyState.glowSourceView,
    targetView,
    webGpuState.glowTargetWidth,
    webGpuState.glowTargetHeight,
    0,
    [0, 0],
    0.001,
    1,
    "load",
  );
}

function renderSignedFieldWithWebGpu(
  spatialAtlas: SpatialAtlasCache,
  modeRenderState: ModeRenderState,
  params: WebGpuRenderParams,
  frameProfileTools: WebGpuFrameProfileTools,
): boolean {
  if (!webGpuState.ready || !ensureCanvasConfigured()) {
    return false;
  }

  try {
    const readyState = requireInitializedWebGpuState();
    const encoder = readyState.device.createCommandEncoder();
    const shouldDebugPercentile =
      state.combineMode === "percentile" &&
      !params.isSingleMode &&
      (profiler.enabled || window.location.hash.includes("percentile-debug"));
    let cpuPercentileMetrics: { threshold: number; displayScale: number } | null = null;

    let profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    encodeFieldPass(encoder, spatialAtlas, modeRenderState, params.isSingleMode, params.useGlowColor);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "webgpuField", profileStart);

    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    encodeReductionPasses(encoder);
    encodePercentilePasses(encoder, state.combineMode === "percentile" && !params.isSingleMode);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "webgpuReduce", profileStart);

    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    const targetView = readyState.context.getCurrentTexture().createView();
    encodeBackgroundPass(encoder, targetView, params);
    encodeContourPass(encoder);
    if (state.renderStyle === "glow") {
      renderGlowContours(encoder, targetView, params);
    } else {
      renderIsolineContours(encoder, targetView, params);
    }
    if (shouldDebugPercentile) {
      webGpuState.percentileDebugFrame += 1;
      if (webGpuState.percentileDebugFrame % PERCENTILE_DEBUG_INTERVAL === 0) {
        cpuPercentileMetrics = computeCpuPercentileMetrics(spatialAtlas, modeRenderState);
        encoder.copyBufferToBuffer(
          readyState.percentileResultBuffer,
          0,
          readyState.percentileDebugBuffer,
          0,
          16,
        );
      }
    }
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "webgpuShade", profileStart);

    readyState.device.queue.submit([encoder.finish()]);
    if (cpuPercentileMetrics) {
      schedulePercentileDebugReadback(readyState, cpuPercentileMetrics);
    }
    setWebGpuCanvasVisible(true, state.plateShape === "circle" && state.combineMode === "signed");
    return true;
  } catch (error) {
    console.warn("WebGPU frame failed, falling back to legacy renderer", error);
    clearWebGpuPresentation();
    return false;
  }
}

export {
  clearWebGpuPresentation,
  handleWebGpuResize,
  primeWebGpuRenderer,
  renderSignedFieldWithWebGpu,
};
