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
@group(0) @binding(2) var colorAccumTex : texture_2d<f32>;
@group(0) @binding(3) var colorWeightTex : texture_2d<f32>;
@group(0) @binding(4) var fieldTex : texture_2d<f32>;

fn normalizeSafe(vector : vec2f) -> vec2f {
  let lengthSq = max(dot(vector, vector), 1e-8);
  return vector * inverseSqrt(lengthSq);
}

fn clamp01(value : f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn luminance(color : vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn sampleTextureBilinear(tex : texture_2d<f32>, uv : vec2f) -> vec4f {
  let maxCoordF = vec2f(383.0, 383.0);
  let maxCoordI = vec2i(383, 383);
  let coord = clamp(uv, vec2f(0.0), vec2f(1.0)) * 383.0;
  let base = floor(coord);
  let frac = coord - base;
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
    inset + (segment.p0.x / 383.0) * drawSize,
    inset + (segment.p0.y / 383.0) * drawSize
  );
  let b = vec2f(
    inset + (segment.p1.x / 383.0) * drawSize,
    inset + (segment.p1.y / 383.0) * drawSize
  );
  out.p0 = a;
  out.p1 = b;

  let direction = normalizeSafe(b - a);
  let normal = vec2f(-direction.y, direction.x);
  let blurRadius = params.style.y;
  let halfSpan = params.style.x * 0.5 + blurRadius * 2.5 + 2.0;
  let alongExtend = halfSpan;
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
  let drawSize = max(params.canvasMetrics.w, 1.0);
  let localUv = clamp((position.xy - vec2f(params.canvasMetrics.z)) / drawSize, vec2f(0.0), vec2f(1.0));
  let accum = sampleTextureBilinear(colorAccumTex, localUv).rgb;
  let weight = sampleTextureBilinear(colorWeightTex, localUv).x;
  let fieldMagnitude = abs(sampleTextureBilinear(fieldTex, localUv).x);

  let fallbackColor = clamp(params.color.rgb, vec3f(0.0), vec3f(255.0));
  let sampledColor = select(fallbackColor, accum / max(weight, 1e-5), weight > 1e-5);
  let fallbackLuma = max(luminance(fallbackColor), 1e-4);
  let sampledLuma = max(luminance(sampledColor), 1e-4);
  let normalizedSampledColor = clamp(sampledColor * mix(0.9, fallbackLuma / sampledLuma, 0.82), vec3f(0.0), vec3f(255.0));
  let energy = 1.0 - exp(-weight * params.flags.w);
  let fieldPulse = 1.0 - exp(-fieldMagnitude * (1.6 + params.style.w * 0.6));
  let sustainedEnergy = pow(energy, 0.85);
  let colorMix = clamp01(params.flags.z * (0.18 + sustainedEnergy * 0.34 + fieldPulse * 0.08));
  let hueColor = mix(fallbackColor, normalizedSampledColor, colorMix);
  let brightness = 0.78 + params.style.w * 0.1 + sustainedEnergy * 0.24 + fieldPulse * 0.1;
  let alphaBoost = 0.76 + sustainedEnergy * 0.3 + fieldPulse * 0.08;
  let resolvedColor = clamp(hueColor * brightness / 255.0, vec3f(0.0), vec3f(1.0)) * clamp01(resolvedAlpha * alphaBoost);
  return vec4f(resolvedColor, clamp01(resolvedAlpha * alphaBoost));
}
