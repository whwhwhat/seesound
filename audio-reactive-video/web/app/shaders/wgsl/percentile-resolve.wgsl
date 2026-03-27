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
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

struct PercentileResult {
  threshold : f32,
  displayScale : f32,
  enabledFlag : f32,
  maxField : f32,
};

@group(0) @binding(0) var<storage, read_write> maxField : MaxFieldBuffer;
@group(0) @binding(1) var<uniform> params : PercentileParams;
@group(0) @binding(2) var<storage, read_write> histogram : HistogramBuffer;
@group(0) @binding(3) var<storage, read_write> result : PercentileResult;

fn binCenter(index : u32, maxAbs : f32) -> f32 {
  let binWidth = maxAbs / 4096.0;
  return (f32(index) + 0.5) * binWidth;
}

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x != 0u || gid.y != 0u || gid.z != 0u) {
    return;
  }

  let maxAbs = max(bitcast<f32>(atomicLoad(&maxField.valueBits)), 1e-6);
  if (params.enabledFlag == 0u) {
    result.threshold = 0.0;
    result.displayScale = maxAbs;
    result.enabledFlag = 0.0;
    result.maxField = maxAbs;
    return;
  }

  let totalCount = atomicLoad(&histogram.bins[4096]);
  if (totalCount == 0u) {
    result.threshold = 0.0;
    result.displayScale = maxAbs;
    result.enabledFlag = 0.0;
    result.maxField = maxAbs;
    return;
  }

  let targetIndex = min(totalCount - 1u, u32(floor(f32(totalCount - 1u) * params.q)));
  var cumulative = 0u;
  var thresholdBin = 0u;
  var foundThreshold = false;

  for (var index = 0u; index < 4096u; index += 1u) {
    let count = atomicLoad(&histogram.bins[index]);
    if (count == 0u) {
      continue;
    }
    cumulative += count;
    if (!foundThreshold && cumulative > targetIndex) {
      thresholdBin = index;
      foundThreshold = true;
    }
  }

  let threshold = binCenter(select(0u, thresholdBin, foundThreshold), maxAbs);
  result.threshold = threshold;
  result.displayScale = max(threshold, maxAbs - threshold);
  result.enabledFlag = 1.0;
  result.maxField = maxAbs;
}
