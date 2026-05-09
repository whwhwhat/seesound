struct ReduceParams {
  srcWidth : u32,
  srcHeight : u32,
  _pad0 : u32,
  _pad1 : u32,
};

@group(0) @binding(0) var sourceTex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> params : ReduceParams;

fn loadSource(coord : vec2u) -> f32 {
  let clamped = min(coord, vec2u(max(params.srcWidth, 1u) - 1u, max(params.srcHeight, 1u) - 1u));
  return abs(textureLoad(sourceTex, vec2i(clamped), 0).x);
}

@fragment
fn main(@builtin(position) position : vec4f) -> @location(0) vec4f {
  let dst = vec2u(position.xy);
  let base = dst * 2u;
  let v0 = loadSource(base);
  let v1 = loadSource(base + vec2u(1u, 0u));
  let v2 = loadSource(base + vec2u(0u, 1u));
  let v3 = loadSource(base + vec2u(1u, 1u));
  return vec4f(max(max(v0, v1), max(v2, v3)), 0.0, 0.0, 1.0);
}
