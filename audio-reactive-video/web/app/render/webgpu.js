import {
  BASE_BG_COLOR,
  atmosphereEnabledInput,
  fieldGeometry,
  fieldSize,
  numericControls,
  state,
  wgpuCanvas,
} from "../state/context.js";

const MAX_MODES = 48;
const WEBGPU_FIELD_FORMAT = "rgba16float";
const WEBGPU_ATLAS_FORMAT = "r32float";
const WEBGPU_DITHER_FORMAT = "r32float";

const FULLSCREEN_VERTEX_SHADER = `
struct VertexOut {
  @builtin(position) position : vec4f,
};

@vertex
fn main(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );
  var out : VertexOut;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  return out;
}
`;

const FIELD_SHADER = `
struct FieldParams {
  modeCount : u32,
  singleMode : u32,
  signedMode : u32,
  useGlowColor : u32,
};

struct ModeState {
  primary : vec4f,
  color : vec4f,
};

struct FieldOut {
  @location(0) field : vec4f,
  @location(1) colorAccum : vec4f,
  @location(2) colorWeight : vec4f,
};

@group(0) @binding(0) var sharpAtlas : texture_2d_array<f32>;
@group(0) @binding(1) var blurredAtlas : texture_2d_array<f32>;
@group(0) @binding(2) var<storage, read> modeStates : array<ModeState, ${MAX_MODES}>;
@group(0) @binding(3) var<uniform> params : FieldParams;

@fragment
fn main(@builtin(position) position : vec4f) -> FieldOut {
  let texel = vec2i(position.xy);
  var fieldValue = 0.0;
  var colorAccum = vec3f(0.0);
  var colorWeight = 0.0;

  for (var index : u32 = 0u; index < params.modeCount; index += 1u) {
    let mode = modeStates[index];
    if (mode.primary.x < 0.5) {
      continue;
    }
    let contribution = mode.primary.y;
    let sharpMix = mode.primary.z;
    let blurMix = mode.primary.w;
    let sharpValue = textureLoad(sharpAtlas, texel, i32(index), 0).x;
    let blurredValue = textureLoad(blurredAtlas, texel, i32(index), 0).x;
    let spatialValue = sharpValue * sharpMix + blurredValue * blurMix;
    let signedContribution = spatialValue * contribution;
    let resolvedContribution =
      select(abs(signedContribution), signedContribution, params.singleMode == 1u || params.signedMode == 1u);
    fieldValue += resolvedContribution;

    if (params.useGlowColor == 1u) {
      let weight = abs(resolvedContribution);
      colorAccum += mode.color.rgb * weight;
      colorWeight += weight;
    }
  }

  var out : FieldOut;
  out.field = vec4f(fieldValue, 0.0, 0.0, 1.0);
  out.colorAccum = vec4f(colorAccum, 1.0);
  out.colorWeight = vec4f(colorWeight, 0.0, 0.0, 1.0);
  return out;
}
`;

const REDUCE_SHADER = `
struct ReduceParams {
  srcWidth : u32,
  srcHeight : u32,
  _pad0 : u32,
  _pad1 : u32,
};

@group(0) @binding(0) var sourceTex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> params : ReduceParams;

fn loadSource(coord : vec2u) -> f32 {
  let clamped = min(coord, vec2u(max(params.srcWidth, 1u) - 1u, max(params.srcHeight, 1u) - 1u));
  return abs(textureLoad(sourceTex, vec2i(clamped), 0).x);
}

@fragment
fn main(@builtin(position) position : vec4f) -> @location(0) vec4f {
  let dst = vec2u(position.xy);
  let base = dst * 2u;
  let v0 = loadSource(base);
  let v1 = loadSource(base + vec2u(1u, 0u));
  let v2 = loadSource(base + vec2u(0u, 1u));
  let v3 = loadSource(base + vec2u(1u, 1u));
  return vec4f(max(max(v0, v1), max(v2, v3)), 0.0, 0.0, 1.0);
}
`;

const SHADE_SHADER = `
struct ShadeParams {
  canvasSize : vec4f,
  dynamicsA : vec4f,
  dynamicsB : vec4f,
  renderFlags : vec4f,
  extras : vec4f,
  baseBgColor : vec4f,
  backdropColor : vec4f,
  baseColor : vec4f,
  lineColor : vec4f,
  outerColor : vec4f,
  glowColor : vec4f,
  atmosphereCore : vec4f,
  atmosphereOuter : vec4f,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var colorAccumTex : texture_2d<f32>;
@group(0) @binding(2) var colorWeightTex : texture_2d<f32>;
@group(0) @binding(3) var maxFieldTex : texture_2d<f32>;
@group(0) @binding(4) var ditherTex : texture_2d<f32>;
@group(0) @binding(5) var<uniform> params : ShadeParams;

fn clamp01(value : f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn sampleField(coord : vec2i) -> f32 {
  let maxCoord = vec2i(${fieldSize - 1}, ${fieldSize - 1});
  return textureLoad(fieldTex, clamp(coord, vec2i(0), maxCoord), 0).x;
}

fn sampleDither(coord : vec2i) -> f32 {
  let maxCoord = vec2i(${fieldSize - 1}, ${fieldSize - 1});
  return textureLoad(ditherTex, clamp(coord, vec2i(0), maxCoord), 0).x;
}

@fragment
fn main(@builtin(position) position : vec4f) -> @location(0) vec4f {
  let canvasSize = max(params.canvasSize.xy, vec2f(1.0));
  let uv = position.xy / canvasSize;
  let inset = 0.09;
  let drawScale = max(1.0 - inset * 2.0, 1e-6);
  let localUv = (uv - vec2f(inset)) / drawScale;
  let insideRect = all(localUv >= vec2f(0.0)) && all(localUv <= vec2f(1.0));

  var color = params.baseBgColor.rgb;
  let globalCentered = uv - vec2f(0.5);
  let distanceToCenter = length(globalCentered);
  if (params.renderFlags.z > 0.5) {
    let atmosphereMix = (1.0 - smoothstep(0.06, 0.48, distanceToCenter)) * 0.14;
    let atmosphereEdge = (1.0 - smoothstep(0.18, 0.52, distanceToCenter)) * 0.08;
    color += params.atmosphereCore.rgb * atmosphereMix + params.atmosphereOuter.rgb * atmosphereEdge;
  }

  if (!insideRect) {
    return vec4f(clamp(color / 255.0, vec3f(0.0), vec3f(1.0)), 1.0);
  }

  let fieldCoordF = clamp(localUv, vec2f(0.0), vec2f(1.0)) * f32(${fieldSize - 1});
  let fieldCoord = vec2i(fieldCoordF + vec2f(0.5));
  let rawField = sampleField(fieldCoord);
  let maxAbs = max(textureLoad(maxFieldTex, vec2i(0, 0), 0).x, 1e-6);
  let displayScale = select(maxAbs, 1.0, params.renderFlags.x > 0.5);
  let normalizedField = rawField / max(displayScale, 1e-6);

  let gx = (sampleField(fieldCoord + vec2i(1, 0)) - sampleField(fieldCoord - vec2i(1, 0))) * 0.5;
  let gy = (sampleField(fieldCoord + vec2i(0, 1)) - sampleField(fieldCoord - vec2i(0, 1))) * 0.5;
  let gradientLength = max(length(vec2f(gx, gy)), 1e-5);
  let contourDistance = abs(rawField) / gradientLength;
  let normalizedGradient = clamp01(gradientLength / max(displayScale, 1e-6) * 2.6);
  let absValue = abs(normalizedField);
  let dither = sampleDither(fieldCoord);

  let centered = localUv - vec2f(0.5);
  let squareRadius = length(centered) / 0.72;
  let circleDistance = length(centered);
  let shapeMask = select(
    max(0.0, 1.0 - squareRadius * squareRadius),
    1.0 - smoothstep(0.5 - 2.5 / f32(${fieldSize}), 0.5 + 1.5 / f32(${fieldSize}), circleDistance),
    params.renderFlags.y > 0.5
  );

  let thicknessNorm = clamp(params.dynamicsB.y / 4.0, 0.1, 2.4);
  let spreadNorm = clamp(params.dynamicsB.z / 2.5, 0.08, 4.0);
  let renderDormant = params.renderFlags.w > 0.5;

  let distanceCore = select(0.0, exp(-contourDistance * (1.6 + params.dynamicsB.y * 0.32)), !renderDormant);
  let distanceHalo = select(0.0, exp(-contourDistance * (0.7 + params.dynamicsB.z * 0.16)), !renderDormant);
  let absCore = select(0.0, exp(-absValue * (params.dynamicsA.w / thicknessNorm)), !renderDormant);
  let absHalo = select(0.0, exp(-absValue * (params.dynamicsB.x / max(0.35, spreadNorm))), !renderDormant);
  let outerHalo = select(0.0, exp(-contourDistance * (0.42 + spreadNorm * 0.08)), !renderDormant);

  var lineStrength = (distanceCore * 0.8 + absCore * 0.2) * (params.dynamicsA.x + normalizedGradient * 1.25) * params.dynamicsA.z;
  var haloStrength = (distanceHalo * 0.72 + absHalo * 0.28) * (params.dynamicsA.y + normalizedGradient * 0.22) * params.dynamicsA.z;
  var glowStrength = outerHalo * (0.06 + spreadNorm * 0.025 + params.dynamicsA.z * 0.05);
  let displacement = pow(min(1.0, absValue), params.extras.x);
  var backgroundField = displacement * params.dynamicsB.w * params.dynamicsA.z;

  if (params.extras.z > 0.5) {
    lineStrength = exp(-contourDistance * (1.8 + params.dynamicsB.y * 0.18)) * (0.42 + params.dynamicsA.z * 0.58);
    haloStrength = exp(-contourDistance * (0.95 + params.dynamicsB.z * 0.06)) * 0.08;
    glowStrength = 0.0;
    backgroundField *= 0.22;
  }

  let brightness = min(1.0, (lineStrength + haloStrength + glowStrength + backgroundField) * shapeMask);
  let warm = min(1.0, brightness * (0.7 + params.canvasSize.z * 0.55));
  let cool = min(1.0, (normalizedGradient * 0.28 + params.canvasSize.w * 0.18 + absHalo * 0.12 + outerHalo * 0.03) * shapeMask);
  let warmD = clamp01(warm + dither * 0.7);
  let brightD = clamp01(brightness + dither);
  let coolD = clamp01(cool + dither * 0.55);

  color = vec3f(
    params.baseBgColor.r + warmD * params.backdropColor.r * 0.82 + brightD * params.baseColor.r * 0.12,
    params.baseBgColor.g + brightD * params.backdropColor.g * 0.84 + lineStrength * params.lineColor.g * 0.12,
    params.baseBgColor.b + coolD * params.backdropColor.b * 0.92 + lineStrength * params.lineColor.b * 0.1
  );
  color += params.outerColor.rgb * glowStrength * 0.14;
  color += params.glowColor.rgb * glowStrength * (0.08 + spreadNorm * 0.015);

  if (params.renderFlags.z > 0.5) {
    let atmosphereMix = (1.0 - smoothstep(0.06, 0.48, distanceToCenter)) * (0.14 + brightness * 0.1);
    let atmosphereEdge = (1.0 - smoothstep(0.18, 0.52, distanceToCenter)) * 0.08;
    color += params.atmosphereCore.rgb * atmosphereMix + params.atmosphereOuter.rgb * atmosphereEdge;
  }

  if (params.extras.y > 0.5) {
    let accum = textureLoad(colorAccumTex, fieldCoord, 0).rgb;
    let weight = textureLoad(colorWeightTex, fieldCoord, 0).x;
    if (weight > 1e-6) {
      let avgColor = accum / weight;
      let monoLuma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
      let avgLuma = dot(avgColor, vec3f(0.2126, 0.7152, 0.0722));
      let luminanceScale = monoLuma / max(avgLuma, 1.0);
      let tinted = clamp(avgColor * luminanceScale, vec3f(0.0), vec3f(255.0));
      let boostedTint = vec3f(
        clamp(tinted.r * (0.98 - params.extras.w * 0.06), 0.0, 255.0),
        clamp(tinted.g * (1.0 + params.extras.w * 0.03), 0.0, 255.0),
        clamp(tinted.b * (1.03 + params.extras.w * 0.16), 0.0, 255.0)
      );
      let tintMix = clamp(
        0.18 + params.extras.w * 0.16
        + lineStrength * (0.96 + params.extras.w * 0.22)
        + haloStrength * (0.64 + params.extras.w * 0.16)
        + backgroundField * (0.34 + params.extras.w * 0.08),
        0.0,
        0.98
      );
      color = mix(color, boostedTint, tintMix);
    }
  }

  if (params.renderFlags.y > 0.5) {
    let canvasMin = max(min(canvasSize.x, canvasSize.y), 1.0);
    let ringWidth = max(10.0 / canvasMin, 0.01);
    let ringOuter = smoothstep(0.5 - ringWidth * 1.4, 0.5, circleDistance);
    let ringInner = smoothstep(0.5 - ringWidth * 2.1, 0.5 - ringWidth * 0.8, circleDistance);
    let ringMix = clamp(ringOuter - ringInner, 0.0, 1.0);
    color = mix(color, params.baseBgColor.rgb * 0.92, ringMix * 0.96);
  } else {
    let canvasMin = max(min(canvasSize.x, canvasSize.y), 1.0);
    let borderWidth = max(2.0 / canvasMin, 0.001);
    let borderDist = min(min(localUv.x, localUv.y), min(1.0 - localUv.x, 1.0 - localUv.y));
    let borderMix = 1.0 - smoothstep(0.0, borderWidth, borderDist);
    color = mix(color, params.outerColor.rgb * 0.18, borderMix);
  }

  return vec4f(clamp(color / 255.0, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

const webGpuState = {
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
  shadePipeline: null,
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
  shadeParamsBuffer: null,
  dirtyContextConfig: true,
};

function isWebGpuSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.gpu) && Boolean(wgpuCanvas);
}

function setWebGpuCanvasVisible(visible, rotateCircleSigned = false) {
  if (!wgpuCanvas) {
    return;
  }
  wgpuCanvas.classList.toggle("is-visible", visible);
  wgpuCanvas.style.transform = rotateCircleSigned ? "rotate(-90deg)" : "";
}

function handleWebGpuResize() {
  webGpuState.dirtyContextConfig = true;
}

function clearWebGpuPresentation() {
  setWebGpuCanvasVisible(false, false);
}

function createShaderModule(code) {
  return webGpuState.device.createShaderModule({ code });
}

function createFieldTextures() {
  webGpuState.fieldTexture = webGpuState.device.createTexture({
    size: [fieldSize, fieldSize],
    format: WEBGPU_FIELD_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  webGpuState.fieldView = webGpuState.fieldTexture.createView();

  webGpuState.colorAccumTexture = webGpuState.device.createTexture({
    size: [fieldSize, fieldSize],
    format: WEBGPU_FIELD_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  webGpuState.colorAccumView = webGpuState.colorAccumTexture.createView();

  webGpuState.colorWeightTexture = webGpuState.device.createTexture({
    size: [fieldSize, fieldSize],
    format: WEBGPU_FIELD_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  webGpuState.colorWeightView = webGpuState.colorWeightTexture.createView();
}

function buildReductionChain() {
  const chain = [];
  let width = fieldSize;
  let height = fieldSize;
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.ceil(width / 2));
    height = Math.max(1, Math.ceil(height / 2));
    const texture = webGpuState.device.createTexture({
      size: [width, height],
      format: WEBGPU_FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
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

function createStaticTextures() {
  webGpuState.sharpAtlasTexture = webGpuState.device.createTexture({
    size: [fieldSize, fieldSize, MAX_MODES],
    format: WEBGPU_ATLAS_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  webGpuState.blurredAtlasTexture = webGpuState.device.createTexture({
    size: [fieldSize, fieldSize, MAX_MODES],
    format: WEBGPU_ATLAS_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  webGpuState.ditherTexture = webGpuState.device.createTexture({
    size: [fieldSize, fieldSize],
    format: WEBGPU_DITHER_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  webGpuState.modeStateBuffer = webGpuState.device.createBuffer({
    size: MAX_MODES * 8 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  webGpuState.fieldParamsBuffer = webGpuState.device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  webGpuState.reduceParamsBuffer = webGpuState.device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  webGpuState.shadeParamsBuffer = webGpuState.device.createBuffer({
    size: 13 * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

function createPipelines() {
  const vertexModule = createShaderModule(FULLSCREEN_VERTEX_SHADER);
  const fieldModule = createShaderModule(FIELD_SHADER);
  const reduceModule = createShaderModule(REDUCE_SHADER);
  const shadeModule = createShaderModule(SHADE_SHADER);

  webGpuState.fieldPipeline = webGpuState.device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: vertexModule,
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

  webGpuState.reducePipeline = webGpuState.device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: vertexModule,
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

  webGpuState.shadePipeline = webGpuState.device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: vertexModule,
      entryPoint: "main",
    },
    fragment: {
      module: shadeModule,
      entryPoint: "main",
      targets: [{ format: webGpuState.canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
}

function uploadDitherTexture() {
  webGpuState.device.queue.writeTexture(
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

function ensureCanvasConfigured() {
  if (!webGpuState.ready || !webGpuState.context) {
    return false;
  }
  const sizeKey = `${wgpuCanvas.width}x${wgpuCanvas.height}`;
  if (!webGpuState.dirtyContextConfig && webGpuState.currentCanvasSize === sizeKey) {
    return true;
  }
  webGpuState.context.configure({
    device: webGpuState.device,
    format: webGpuState.canvasFormat,
    alphaMode: "opaque",
  });
  webGpuState.currentCanvasSize = sizeKey;
  webGpuState.dirtyContextConfig = false;
  return true;
}

async function primeWebGpuRenderer() {
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
      webGpuState.adapter = await navigator.gpu.requestAdapter();
      if (!webGpuState.adapter) {
        throw new Error("No WebGPU adapter available");
      }
      webGpuState.device = await webGpuState.adapter.requestDevice();
      webGpuState.context = wgpuCanvas.getContext("webgpu");
      if (!webGpuState.context) {
        throw new Error("WebGPU canvas context unavailable");
      }
      webGpuState.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
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

function uploadSpatialAtlas(spatialAtlas) {
  if (webGpuState.uploadedAtlasKey === spatialAtlas.key) {
    return;
  }
  const uploadExtent = {
    width: fieldSize,
    height: fieldSize,
    depthOrArrayLayers: spatialAtlas.modeCount,
  };
  webGpuState.device.queue.writeTexture(
    { texture: webGpuState.sharpAtlasTexture },
    spatialAtlas.sharp,
    {
      offset: 0,
      bytesPerRow: fieldSize * 4,
      rowsPerImage: fieldSize,
    },
    uploadExtent,
  );
  webGpuState.device.queue.writeTexture(
    { texture: webGpuState.blurredAtlasTexture },
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

function uploadModeState(modeRenderState) {
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
  webGpuState.device.queue.writeBuffer(webGpuState.modeStateBuffer, 0, packed);
}

function encodeFieldPass(encoder, spatialAtlas, modeRenderState, isSingleMode, useGlowColor) {
  uploadSpatialAtlas(spatialAtlas);
  uploadModeState(modeRenderState);
  const fieldParams = new Uint32Array([
    state.modeState.length,
    isSingleMode ? 1 : 0,
    state.combineMode === "signed" ? 1 : 0,
    useGlowColor ? 1 : 0,
  ]);
  webGpuState.device.queue.writeBuffer(webGpuState.fieldParamsBuffer, 0, fieldParams);

  const bindGroup = webGpuState.device.createBindGroup({
    layout: webGpuState.fieldPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: webGpuState.sharpAtlasTexture.createView({ dimension: "2d-array", arrayLayerCount: MAX_MODES }) },
      { binding: 1, resource: webGpuState.blurredAtlasTexture.createView({ dimension: "2d-array", arrayLayerCount: MAX_MODES }) },
      { binding: 2, resource: { buffer: webGpuState.modeStateBuffer } },
      { binding: 3, resource: { buffer: webGpuState.fieldParamsBuffer } },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: webGpuState.fieldView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
      {
        view: webGpuState.colorAccumView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
      {
        view: webGpuState.colorWeightView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(webGpuState.fieldPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
}

function encodeReductionPasses(encoder) {
  let sourceView = webGpuState.fieldView;
  let sourceWidth = fieldSize;
  let sourceHeight = fieldSize;

  for (const target of webGpuState.reductionChain) {
    webGpuState.device.queue.writeBuffer(
      webGpuState.reduceParamsBuffer,
      0,
      new Uint32Array([sourceWidth, sourceHeight, 0, 0]),
    );
    const bindGroup = webGpuState.device.createBindGroup({
      layout: webGpuState.reducePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: { buffer: webGpuState.reduceParamsBuffer } },
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
    pass.setPipeline(webGpuState.reducePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
    sourceView = target.view;
    sourceWidth = target.width;
    sourceHeight = target.height;
  }
}

function encodeShadePass(encoder, params) {
  const {
    rms,
    centroid,
    contrast,
    coreSharpness,
    haloSharpness,
    lineWeight,
    haloWeight,
    backgroundWeight,
    singleAmpGate,
    separation,
    renderAsDormantField,
    useGlowColor,
    themePalette,
    glowColor,
    isSingleMode,
  } = params;

  const styleMode = state.renderStyle === "isoline" ? 1 : 0;
  const renderFlags = new Float32Array([
    isSingleMode ? 1 : 0,
    state.plateShape === "circle" ? 1 : 0,
    atmosphereEnabledInput.checked ? 1 : 0,
    renderAsDormantField ? 1 : 0,
  ]);
  const extras = new Float32Array([
    contrast,
    useGlowColor ? 1 : 0,
    styleMode,
    separation,
  ]);
  const shadeParams = new Float32Array([
    wgpuCanvas.width, wgpuCanvas.height, centroid, rms,
    lineWeight, haloWeight, singleAmpGate, coreSharpness,
    haloSharpness, numericControls.glowThickness, numericControls.glowSpread, backgroundWeight,
    0, 0, 0, 0,
    0, 0, 0, 0,
    BASE_BG_COLOR[0], BASE_BG_COLOR[1], BASE_BG_COLOR[2], 0,
    themePalette.backdropColor[0], themePalette.backdropColor[1], themePalette.backdropColor[2], 0,
    themePalette.baseColor[0], themePalette.baseColor[1], themePalette.baseColor[2], 0,
    themePalette.lineColor[0], themePalette.lineColor[1], themePalette.lineColor[2], 0,
    themePalette.outerColor[0], themePalette.outerColor[1], themePalette.outerColor[2], 0,
    glowColor[0], glowColor[1], glowColor[2], 0,
    themePalette.atmosphereCore[0], themePalette.atmosphereCore[1], themePalette.atmosphereCore[2], 0,
    themePalette.atmosphereOuter[0], themePalette.atmosphereOuter[1], themePalette.atmosphereOuter[2], 0,
  ]);
  shadeParams.set(renderFlags, 12);
  shadeParams.set(extras, 16);
  webGpuState.device.queue.writeBuffer(webGpuState.shadeParamsBuffer, 0, shadeParams);

  const reductionView = webGpuState.reductionChain[webGpuState.reductionChain.length - 1]?.view ?? webGpuState.fieldView;
  const bindGroup = webGpuState.device.createBindGroup({
    layout: webGpuState.shadePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: webGpuState.fieldView },
      { binding: 1, resource: webGpuState.colorAccumView },
      { binding: 2, resource: webGpuState.colorWeightView },
      { binding: 3, resource: reductionView },
      { binding: 4, resource: webGpuState.ditherTexture.createView() },
      { binding: 5, resource: { buffer: webGpuState.shadeParamsBuffer } },
    ],
  });

  const targetView = webGpuState.context.getCurrentTexture().createView();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(webGpuState.shadePipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
}

function renderSignedFieldWithWebGpu(spatialAtlas, modeRenderState, params, frameProfileTools) {
  if (!webGpuState.ready || !ensureCanvasConfigured()) {
    return false;
  }
  try {
    const encoder = webGpuState.device.createCommandEncoder();

    let profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    encodeFieldPass(encoder, spatialAtlas, modeRenderState, params.isSingleMode, params.useGlowColor);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "webgpuField", profileStart);

    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    encodeReductionPasses(encoder);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "webgpuReduce", profileStart);

    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    encodeShadePass(encoder, params);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "webgpuShade", profileStart);

    webGpuState.device.queue.submit([encoder.finish()]);
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
