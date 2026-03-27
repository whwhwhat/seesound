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
