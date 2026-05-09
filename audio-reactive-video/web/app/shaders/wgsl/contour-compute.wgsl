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

struct PercentileResult {
  threshold : f32,
  displayScale : f32,
  enabledFlag : f32,
  _pad1 : f32,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> segments : array<Segment>;
@group(0) @binding(2) var<uniform> params : ContourParams;
@group(0) @binding(3) var<storage, read> percentile : PercentileResult;

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
  if (gid.x >= 383u || gid.y >= 383u) {
    return;
  }

  let baseIndex = (gid.y * 383u + gid.x) * 2u;
  writeEmpty(baseIndex);
  writeEmpty(baseIndex + 1u);

  if (params.shapeMode == 1u) {
    let cx = f32(gid.x) + 0.5;
    let cy = f32(gid.y) + 0.5;
    let nx = (cx / 383.0) * 2.0 - 1.0;
    let ny = (cy / 383.0) * 2.0 - 1.0;
    let distanceToRim = 1.0 - sqrt(nx * nx + ny * ny);
    if (distanceToRim < 0.015) {
      return;
    }
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  let threshold = percentile.threshold;
  let tl = textureLoad(fieldTex, vec2i(x, y), 0).x - threshold;
  let tr = textureLoad(fieldTex, vec2i(x + 1, y), 0).x - threshold;
  let br = textureLoad(fieldTex, vec2i(x + 1, y + 1), 0).x - threshold;
  let bl = textureLoad(fieldTex, vec2i(x, y + 1), 0).x - threshold;

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
