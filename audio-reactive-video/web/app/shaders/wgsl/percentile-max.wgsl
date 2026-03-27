struct PercentileParams {
  q : f32,
  enabledFlag : u32,
  shapeMode : u32,
  _pad0 : u32,
};

struct MaxFieldBuffer {
  valueBits : atomic<u32>,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> params : PercentileParams;
@group(0) @binding(2) var<storage, read_write> maxField : MaxFieldBuffer;

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

  let value = max(textureLoad(fieldTex, vec2i(gid.xy), 0).x, 0.0);
  atomicMax(&maxField.valueBits, bitcast<u32>(value));
}
