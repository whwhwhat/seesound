struct VertexOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

struct BlurParams {
  canvasMetrics : vec4f,
  directionSigma : vec4f,
};

@group(0) @binding(0) var srcSampler : sampler;
@group(0) @binding(1) var srcTex : texture_2d<f32>;
@group(0) @binding(2) var<uniform> params : BlurParams;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );
  var out : VertexOut;
  let pos = positions[vertexIndex];
  out.position = vec4f(pos, 0.0, 1.0);
  out.uv = vec2f(pos.x * 0.5 + 0.5, 1.0 - (pos.y * 0.5 + 0.5));
  return out;
}

@fragment
fn fsMain(@location(0) uv : vec2f) -> @location(0) vec4f {
  let invSize = max(params.canvasMetrics.xy, vec2f(1e-6));
  let dir = params.directionSigma.xy / invSize;
  let sigma = max(params.directionSigma.z, 0.001);
  let opacity = params.directionSigma.w;
  let sampleStep = max(sigma / 4.0, 1.0);

  var accum = vec4f(0.0);
  var weightSum = 0.0;
  for (var i = -8; i <= 8; i += 1) {
    let offset = f32(i) * sampleStep;
    let weight = exp(-(offset * offset) / (2.0 * sigma * sigma));
    accum += textureSampleLevel(srcTex, srcSampler, uv + dir * offset, 0.0) * weight;
    weightSum += weight;
  }

  let color = accum / max(weightSum, 1e-6);
  return color * opacity;
}
