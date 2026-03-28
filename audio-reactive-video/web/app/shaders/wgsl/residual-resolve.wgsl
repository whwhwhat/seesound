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

struct ResidualAverages {
  values : array<f32, 268>,
};

@group(0) @binding(0) var<uniform> params : ResidualParams;
@group(0) @binding(1) var<storage, read_write> stats : ResidualStats;
@group(0) @binding(2) var<storage, read_write> averages : ResidualAverages;

const RESIDUAL_SCALE : f32 = 1024.0;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let index = gid.x;
  if (index >= params.bucketCount) {
    return;
  }

  let count = atomicLoad(&stats.counts[index]);
  let sum = atomicLoad(&stats.sums[index]);
  averages.values[index] = select(0.0, f32(sum) / (f32(count) * RESIDUAL_SCALE), count > 0u);
}
