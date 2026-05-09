struct VertexOut {
  @builtin(position) position : vec4f,
};

@vertex
fn main(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );
  var out : VertexOut;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  return out;
}
