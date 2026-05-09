struct ResidualParams {
  shapeMode : u32,
  bucketCount : u32,
  _pad0 : u32,
  _pad1 : u32,
};

struct ResidualStats {
  sums : array<atomic<u32>, 268>,
  counts : array<atomic<u32>, 268>,
};

@group(0) @binding(0) var fieldTex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> params : ResidualParams;
@group(0) @binding(2) var<storage, read_write> stats : ResidualStats;

const RESIDUAL_SCALE : f32 = 1024.0;

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
  let scaled = max(0u, u32(round(value * RESIDUAL_SCALE)));
  atomicAdd(&stats.sums[bucket], scaled);
  atomicAdd(&stats.counts[bucket], 1u);
}
