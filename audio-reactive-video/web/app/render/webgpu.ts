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

const MAX_MODES = 48;
const FIELD_STRIDE = fieldSize - 1;
const MAX_CONTOUR_SEGMENTS = FIELD_STRIDE * FIELD_STRIDE * 2;
const SEGMENT_STRIDE_BYTES = 32;
const WEBGPU_FIELD_FORMAT = "rgba16float";
const WEBGPU_ATLAS_FORMAT = "r32float";
const WEBGPU_DITHER_FORMAT = "r32float";
const PRESENTATION_SUPERSAMPLE = 2;
const PRESENTATION_MAX_SIZE = 2048;

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

const BACKGROUND_SHADER = `
struct BackgroundParams {
  canvasSize : vec4f,
  dynamics : vec4f,
  renderFlags : vec4f,
  baseBgColor : vec4f,
  backdropColor : vec4f,
  baseColor : vec4f,
  outerColor : vec4f,
  atmosphereCore : vec4f,
  atmosphereOuter : vec4f,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var colorAccumTex : texture_2d<f32>;
@group(0) @binding(2) var colorWeightTex : texture_2d<f32>;
@group(0) @binding(3) var maxFieldTex : texture_2d<f32>;
@group(0) @binding(4) var ditherTex : texture_2d<f32>;
@group(0) @binding(5) var<uniform> params : BackgroundParams;

fn clamp01(value : f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn sampleTextureBilinear(tex : texture_2d<f32>, coord : vec2f) -> vec4f {
  let maxCoordF = vec2f(${fieldSize - 1}, ${fieldSize - 1});
  let maxCoordI = vec2i(${fieldSize - 1}, ${fieldSize - 1});
  let clamped = clamp(coord, vec2f(0.0), maxCoordF);
  let base = floor(clamped);
  let frac = clamped - base;
  let i00 = vec2i(base);
  let i10 = min(i00 + vec2i(1, 0), maxCoordI);
  let i01 = min(i00 + vec2i(0, 1), maxCoordI);
  let i11 = min(i00 + vec2i(1, 1), maxCoordI);
  let s00 = textureLoad(tex, i00, 0);
  let s10 = textureLoad(tex, i10, 0);
  let s01 = textureLoad(tex, i01, 0);
  let s11 = textureLoad(tex, i11, 0);
  let sx0 = mix(s00, s10, frac.x);
  let sx1 = mix(s01, s11, frac.x);
  return mix(sx0, sx1, frac.y);
}

fn sampleRepeatedDither(uv : vec2f) -> f32 {
  let tiledUv = fract(uv * vec2f(3.11, 2.73) + vec2f(0.17, 0.29));
  let coord = tiledUv * f32(${fieldSize - 1});
  return sampleTextureBilinear(ditherTex, coord).x;
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
  let atmosphereDither = sampleRepeatedDither(uv);
  if (params.renderFlags.z > 0.5) {
    let atmosphereMix = (1.0 - smoothstep(0.04, 0.52, distanceToCenter)) * 0.085;
    let atmosphereEdge = (1.0 - smoothstep(0.14, 0.58, distanceToCenter)) * 0.038;
    let atmosphereNoise = atmosphereDither * 52.0 * clamp01((atmosphereMix + atmosphereEdge) * 7.5);
    color += params.atmosphereCore.rgb * atmosphereMix + params.atmosphereOuter.rgb * atmosphereEdge + vec3f(atmosphereNoise);
  }

  if (!insideRect) {
    return vec4f(clamp(color / 255.0, vec3f(0.0), vec3f(1.0)), 1.0);
  }

  let fieldCoord = clamp(localUv, vec2f(0.0), vec2f(1.0)) * f32(${fieldSize - 1});
  let field = sampleTextureBilinear(fieldTex, fieldCoord).x;
  let maxAbs = max(textureLoad(maxFieldTex, vec2i(0, 0), 0).x, 1e-6);
  let displayScale = select(maxAbs, 1.0, params.renderFlags.x > 0.5);
  let normalizedField = field / max(displayScale, 1e-6);
  let dither = sampleTextureBilinear(ditherTex, fieldCoord).x;

  let gx = textureLoad(fieldTex, min(vec2i(fieldCoord) + vec2i(1, 0), vec2i(${fieldSize - 1}, ${fieldSize - 1})), 0).x - field;
  let gy = textureLoad(fieldTex, min(vec2i(fieldCoord) + vec2i(0, 1), vec2i(${fieldSize - 1}, ${fieldSize - 1})), 0).x - field;
  let gradient = min(1.0, (abs(gx) + abs(gy)) / max(displayScale, 1e-6) * 2.6);
  let centered = localUv - vec2f(0.5);
  let squareRadius = length(centered) / 0.72;
  let circleDistance = length(centered);
  let mask = select(
    max(0.0, 1.0 - squareRadius * squareRadius),
    1.0 - smoothstep(0.5 - 2.5 / f32(${fieldSize}), 0.5 + 1.5 / f32(${fieldSize}), circleDistance),
    params.renderFlags.y > 0.5
  );

  let absValue = abs(normalizedField);
  let nodeHalo = select(0.0, exp(-absValue * (params.dynamics.x / max(0.35, params.dynamics.w))), params.renderFlags.w < 0.5);
  let outerHalo = select(0.0, exp(-absValue * (params.dynamics.x / max(0.22, params.dynamics.w * 1.45))), params.renderFlags.w < 0.5);
  let displacement = pow(min(1.0, absValue), params.dynamics.z);
  let underlayStrength = min(
    1.0,
    (displacement * params.dynamics.y * params.dynamics.w * 1.10 + nodeHalo * 0.12 + outerHalo * 0.06 + gradient * 0.04) * mask
  );

  color = vec3f(
    params.baseBgColor.r + underlayStrength * params.backdropColor.r * 0.24,
    params.baseBgColor.g + underlayStrength * params.backdropColor.g * 0.26,
    params.baseBgColor.b + underlayStrength * params.backdropColor.b * 0.30
  );

  let accum = sampleTextureBilinear(colorAccumTex, fieldCoord).rgb;
  let weight = sampleTextureBilinear(colorWeightTex, fieldCoord).x;
  if (weight > 1e-6) {
    let avgColor = accum / weight;
    let tintMix = clamp(underlayStrength * 0.18, 0.0, 0.24);
    color = mix(color, avgColor * 0.35 + color * 0.65, tintMix);
  }

  let warmD = clamp01(underlayStrength + dither * 0.16);
  color += params.baseColor.rgb * warmD * 0.022;

  if (params.renderFlags.z > 0.5) {
    let atmosphereMix = (1.0 - smoothstep(0.04, 0.52, distanceToCenter)) * (0.072 + underlayStrength * 0.038);
    let atmosphereEdge = (1.0 - smoothstep(0.14, 0.58, distanceToCenter)) * 0.032;
    let atmosphereNoise = atmosphereDither * 60.0 * clamp01((atmosphereMix + atmosphereEdge) * 8.0 + underlayStrength * 0.22);
    color += params.atmosphereCore.rgb * atmosphereMix + params.atmosphereOuter.rgb * atmosphereEdge + vec3f(atmosphereNoise);
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

const BLUR_SHADER = `
struct VertexOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

struct BlurParams {
  canvasMetrics : vec4f,
  directionSigma : vec4f,
};

@group(0) @binding(0) var srcSampler : sampler;
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var<uniform> params : BlurParams;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );
  var out : VertexOut;
  let pos = positions[vertexIndex];
  out.position = vec4f(pos, 0.0, 1.0);
  out.uv = vec2f(pos.x * 0.5 + 0.5, 1.0 - (pos.y * 0.5 + 0.5));
  return out;
}

@fragment
fn fsMain(@location(0) uv : vec2f) -> @location(0) vec4f {
  let invSize = max(params.canvasMetrics.xy, vec2f(1e-6));
  let dir = params.directionSigma.xy / invSize;
  let sigma = max(params.directionSigma.z, 0.001);
  let opacity = params.directionSigma.w;
  let sampleStep = max(sigma / 4.0, 1.0);

  var accum = vec4f(0.0);
  var weightSum = 0.0;
  for (var i = -8; i <= 8; i += 1) {
    let offset = f32(i) * sampleStep;
    let weight = exp(-(offset * offset) / (2.0 * sigma * sigma));
    accum += textureSampleLevel(srcTex, srcSampler, uv + dir * offset, 0.0) * weight;
    weightSum += weight;
  }

  let color = accum / max(weightSum, 1e-6);
  return color * opacity;
}
`;

const CONTOUR_COMPUTE_SHADER = `
struct Segment {
  p0 : vec2f,
  p1 : vec2f,
  payload : vec4f,
};

struct ContourParams {
  shapeMode : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> segments : array<Segment>;
@group(0) @binding(2) var<uniform> params : ContourParams;

fn interpolatePoint(ax : f32, ay : f32, av : f32, bx : f32, by : f32, bv : f32) -> vec2f {
  let denom = bv - av;
  var t = 0.5;
  if (abs(denom) >= 1e-6) {
    t = (0.0 - av) / denom;
  }
  return vec2f(mix(ax, bx, t), mix(ay, by, t));
}

fn writeEmpty(index : u32) {
  segments[index].p0 = vec2f(0.0);
  segments[index].p1 = vec2f(0.0);
  segments[index].payload = vec4f(0.0);
}

fn writeSegment(index : u32, p0 : vec2f, p1 : vec2f) {
  segments[index].p0 = p0;
  segments[index].p1 = p1;
  segments[index].payload = vec4f(1.0, 0.0, 0.0, 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x >= ${FIELD_STRIDE}u || gid.y >= ${FIELD_STRIDE}u) {
    return;
  }

  let baseIndex = (gid.y * ${FIELD_STRIDE}u + gid.x) * 2u;
  writeEmpty(baseIndex);
  writeEmpty(baseIndex + 1u);

  if (params.shapeMode == 1u) {
    let cx = f32(gid.x) + 0.5;
    let cy = f32(gid.y) + 0.5;
    let nx = (cx / f32(${FIELD_STRIDE})) * 2.0 - 1.0;
    let ny = (cy / f32(${FIELD_STRIDE})) * 2.0 - 1.0;
    let distanceToRim = 1.0 - sqrt(nx * nx + ny * ny);
    if (distanceToRim < 0.015) {
      return;
    }
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  let tl = textureLoad(fieldTex, vec2i(x, y), 0).x;
  let tr = textureLoad(fieldTex, vec2i(x + 1, y), 0).x;
  let br = textureLoad(fieldTex, vec2i(x + 1, y + 1), 0).x;
  let bl = textureLoad(fieldTex, vec2i(x, y + 1), 0).x;

  var points : array<vec2f, 4>;
  var pointCount : u32 = 0u;

  if ((tl <= 0.0 && tr > 0.0) || (tl > 0.0 && tr <= 0.0)) {
    points[pointCount] = interpolatePoint(f32(x), f32(y), tl, f32(x + 1), f32(y), tr);
    pointCount += 1u;
  }
  if ((tr <= 0.0 && br > 0.0) || (tr > 0.0 && br <= 0.0)) {
    points[pointCount] = interpolatePoint(f32(x + 1), f32(y), tr, f32(x + 1), f32(y + 1), br);
    pointCount += 1u;
  }
  if ((br <= 0.0 && bl > 0.0) || (br > 0.0 && bl <= 0.0)) {
    points[pointCount] = interpolatePoint(f32(x + 1), f32(y + 1), br, f32(x), f32(y + 1), bl);
    pointCount += 1u;
  }
  if ((bl <= 0.0 && tl > 0.0) || (bl > 0.0 && tl <= 0.0)) {
    points[pointCount] = interpolatePoint(f32(x), f32(y + 1), bl, f32(x), f32(y), tl);
    pointCount += 1u;
  }

  if (pointCount == 2u) {
    writeSegment(baseIndex, points[0], points[1]);
  } else if (pointCount == 4u) {
    writeSegment(baseIndex, points[0], points[1]);
    writeSegment(baseIndex + 1u, points[2], points[3]);
  }
}
`;

const SEGMENT_RENDER_SHADER = `
struct Segment {
  p0 : vec2f,
  p1 : vec2f,
  payload : vec4f,
};

struct LineParams {
  canvasMetrics : vec4f,
  style : vec4f,
  color : vec4f,
  flags : vec4f,
};

struct VertexOut {
  @builtin(position) position : vec4f,
  @location(0) p0 : vec2f,
  @location(1) p1 : vec2f,
  @location(2) visibility : f32,
};

@group(0) @binding(0) var<storage, read> segments : array<Segment>;
@group(0) @binding(1) var<uniform> params : LineParams;

fn normalizeSafe(vector : vec2f) -> vec2f {
  let lengthSq = max(dot(vector, vector), 1e-8);
  return vector * inverseSqrt(lengthSq);
}

@vertex
fn vsMain(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32,
) -> VertexOut {
  let segment = segments[instanceIndex];
  var out : VertexOut;
  out.visibility = segment.payload.x;
  out.p0 = vec2f(0.0);
  out.p1 = vec2f(0.0);

  if (segment.payload.x < 0.5) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    return out;
  }

  let inset = params.canvasMetrics.z;
  let drawSize = params.canvasMetrics.w;
  let canvasSize = max(params.canvasMetrics.xy, vec2f(1.0));
  let a = vec2f(
    inset + (segment.p0.x / f32(${FIELD_STRIDE})) * drawSize,
    inset + (segment.p0.y / f32(${FIELD_STRIDE})) * drawSize
  );
  let b = vec2f(
    inset + (segment.p1.x / f32(${FIELD_STRIDE})) * drawSize,
    inset + (segment.p1.y / f32(${FIELD_STRIDE})) * drawSize
  );
  out.p0 = a;
  out.p1 = b;

  let direction = normalizeSafe(b - a);
  let normal = vec2f(-direction.y, direction.x);
  let blurRadius = params.style.y;
  let halfSpan = params.style.x * 0.5 + blurRadius * 2.5 + 2.0;
  let alongExtend = blurRadius * 2.5 + 2.0;
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, 1.0)
  );
  let corner = corners[vertexIndex];
  let base = mix(a, b, (corner.x + 1.0) * 0.5);
  let world = base + direction * (corner.x * alongExtend) + normal * (corner.y * halfSpan);
  let clip = vec2f(
    world.x / canvasSize.x * 2.0 - 1.0,
    1.0 - world.y / canvasSize.y * 2.0
  );
  out.position = vec4f(clip, 0.0, 1.0);
  return out;
}

fn segmentDistance(point : vec2f, a : vec2f, b : vec2f) -> f32 {
  let ab = b - a;
  let denom = max(dot(ab, ab), 1e-6);
  let t = clamp(dot(point - a, ab) / denom, 0.0, 1.0);
  return length(point - (a + ab * t));
}

@fragment
fn fsMain(
  @builtin(position) position : vec4f,
  @location(0) p0 : vec2f,
  @location(1) p1 : vec2f,
  @location(2) visibility : f32,
) -> @location(0) vec4f {
  if (visibility < 0.5) {
    discard;
  }

  if (params.flags.x > 0.5) {
    let center = params.canvasMetrics.xy * 0.5;
    let radius = params.canvasMetrics.w * 0.5;
    if (distance(position.xy, center) > radius) {
      discard;
    }
  }

  let distanceToSegment = segmentDistance(position.xy, p0, p1);
  let halfWidth = params.style.x * 0.5;
  var alpha = 0.0;
  if (params.flags.y < 0.5) {
    let sigma = max(params.style.y * 0.18, 0.28);
    let intensity = min(3.4, 0.9 + 2.2 / (sigma + 0.35));
    let bodyRadius = max(halfWidth * 0.72, 0.45);
    let edgeDistance = max(distanceToSegment - bodyRadius, 0.0);
    let centerPreserve = 0.14 + 0.86 * smoothstep(bodyRadius * 0.55, bodyRadius + sigma * 0.9, distanceToSegment);
    alpha = params.style.z * intensity * centerPreserve * exp(-(edgeDistance * edgeDistance) / (2.0 * sigma * sigma));
  } else {
    let crispHalfWidth = halfWidth * 0.94;
    alpha = params.style.z * (1.0 - smoothstep(crispHalfWidth, crispHalfWidth + 0.85, distanceToSegment));
  }

  let resolvedAlpha = clamp(alpha, 0.0, 1.0);
  let resolvedColor = clamp(params.color.rgb / 255.0, vec3f(0.0), vec3f(1.0)) * resolvedAlpha;
  return vec4f(resolvedColor, resolvedAlpha);
}
`;

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
  const outerCompositeOpacity = 0.48 * intensity;
  const innerCompositeOpacity = 0.42 * intensity;
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
  const lineWidth = 1.05 + thresholdAlpha * 0.72;
  const lineOpacity = 0.34 + thresholdAlpha * 0.46;

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

    let profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    encodeFieldPass(encoder, spatialAtlas, modeRenderState, params.isSingleMode, params.useGlowColor);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "webgpuField", profileStart);

    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    encodeReductionPasses(encoder);
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
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "webgpuShade", profileStart);

    readyState.device.queue.submit([encoder.finish()]);
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
