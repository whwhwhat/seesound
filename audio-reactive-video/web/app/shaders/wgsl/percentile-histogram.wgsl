struct PercentileParams {
  q : f32,
  enabledFlag : u32,
  shapeMode : u32,
  _pad0 : u32,
};

struct HistogramBuffer {
  bins : array<atomic<u32>, 4097>,
};

struct MaxFieldBuffer {
  valueBits : atomic<u32>,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> maxField : MaxFieldBuffer;
@group(0) @binding(2) var<uniform> params : PercentileParams;
@group(0) @binding(3) var<storage, read_write> histogram : HistogramBuffer;

fn isInsideCircle(coord : vec2u) -> bool {
  let centered = (vec2f(coord) / 383.0) * 2.0 - vec2f(1.0);
  return dot(centered, centered) <= 1.0;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (params.enabledFlag == 0u || gid.x >= 384u || gid.y >= 384u) {
    return;
  }

  if (params.shapeMode == 1u && !isInsideCircle(gid.xy)) {
    return;
  }

  let maxAbs = max(bitcast<f32>(atomicLoad(&maxField.valueBits)), 1e-6);
  let value = textureLoad(fieldTex, vec2i(gid.xy), 0).x;
  let normalized = clamp(value / maxAbs, 0.0, 0.9999999);
  let binIndex = u32(floor(normalized * 4096.0));

  atomicAdd(&histogram.bins[binIndex], 1u);
  atomicAdd(&histogram.bins[4096], 1u);
}
