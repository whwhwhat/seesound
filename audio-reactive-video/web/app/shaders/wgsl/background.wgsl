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

struct PercentileResult {
  threshold : f32,
  displayScale : f32,
  enabledFlag : f32,
  _pad1 : f32,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var colorAccumTex : texture_2d<f32>;
@group(0) @binding(2) var colorWeightTex : texture_2d<f32>;
@group(0) @binding(3) var maxFieldTex : texture_2d<f32>;
@group(0) @binding(4) var ditherTex : texture_2d<f32>;
@group(0) @binding(5) var<uniform> params : BackgroundParams;
@group(0) @binding(6) var<storage, read> percentile : PercentileResult;

fn clamp01(value : f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn sampleTextureBilinear(tex : texture_2d<f32>, coord : vec2f) -> vec4f {
  let maxCoordF = vec2f(383.0, 383.0);
  let maxCoordI = vec2i(383, 383);
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
  let coord = tiledUv * 383.0;
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

  let fieldCoord = clamp(localUv, vec2f(0.0), vec2f(1.0)) * 383.0;
  let maxAbs = max(textureLoad(maxFieldTex, vec2i(0, 0), 0).x, 1e-6);
  let threshold = select(0.0, percentile.threshold, percentile.enabledFlag > 0.5);
  let field = sampleTextureBilinear(fieldTex, fieldCoord).x - threshold;
  let resolvedScale = select(maxAbs, max(percentile.displayScale, 1e-6), percentile.enabledFlag > 0.5);
  let displayScale = select(resolvedScale, 1.0, params.renderFlags.x > 0.5);
  let normalizedField = field / max(displayScale, 1e-6);
  let dither = sampleTextureBilinear(ditherTex, fieldCoord).x;

  let gx = textureLoad(fieldTex, min(vec2i(fieldCoord) + vec2i(1, 0), vec2i(383, 383)), 0).x - threshold - field;
  let gy = textureLoad(fieldTex, min(vec2i(fieldCoord) + vec2i(0, 1), vec2i(383, 383)), 0).x - threshold - field;
  let gradient = min(1.0, (abs(gx) + abs(gy)) / max(displayScale, 1e-6) * 2.6);
  let centered = localUv - vec2f(0.5);
  let squareRadius = length(centered) / 0.72;
  let circleDistance = length(centered);
  let mask = select(
    max(0.0, 1.0 - squareRadius * squareRadius),
    1.0 - smoothstep(0.5 - 2.5 / 384.0, 0.5 + 1.5 / 384.0, circleDistance),
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
  }

  return vec4f(clamp(color / 255.0, vec3f(0.0), vec3f(1.0)), 1.0);
}
