struct ResidualParams {
  shapeMode : u32,
  bucketCount : u32,
  _pad0 : u32,
  _pad1 : u32,
};

struct ResidualAverages {
  values : array<f32, 268>,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> params : ResidualParams;
@group(0) @binding(2) var<storage, read> averages : ResidualAverages;
@group(0) @binding(3) var residualFieldTex : texture_storage_2d<r32float, write>;

fn bucketFor(coord : vec2u) -> u32 {
  if (params.shapeMode == 0u) {
    return 0u;
  }

  let centered = (vec2f(coord) / 383.0) * 2.0 - vec2f(1.0);
  let radius = min(1.0, length(centered));
  return min(params.bucketCount - 1u, u32(floor(radius * f32(params.bucketCount - 1u))));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x >= 384u || gid.y >= 384u) {
    return;
  }

  let bucket = bucketFor(gid.xy);
  let value = textureLoad(fieldTex, vec2i(gid.xy), 0).x;
  let adjusted = value - averages.values[bucket];
  textureStore(residualFieldTex, vec2i(gid.xy), vec4f(adjusted, 0.0, 0.0, 1.0));
}
