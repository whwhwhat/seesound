struct Params {
  canvas : vec4f,
  bands : vec4f,
  dynamics : vec4f,
  lowColor : vec4f,
  midColor : vec4f,
  highColor : vec4f,
  accentColor : vec4f,
  reserved : vec4f,
  translation : vec4f,
}

@group(0) @binding(0) var<uniform> params : Params;

struct VertexOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
}

fn saturate(value : f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn rot2(angle : f32) -> mat2x2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return mat2x2<f32>(c, -s, s, c);
}

fn sdSegment(point : vec2f, a : vec2f, b : vec2f) -> f32 {
  let ab = b - a;
  let h = clamp(dot(point - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
  return length(point - (a + ab * h));
}

fn hypercubeVertex(index : u32) -> vec4f {
  return vec4f(
    select(-1.0, 1.0, (index & 1u) != 0u),
    select(-1.0, 1.0, (index & 2u) != 0u),
    select(-1.0, 1.0, (index & 4u) != 0u),
    select(-1.0, 1.0, (index & 8u) != 0u),
  );
}

fn projectVertex(index : u32) -> vec2f {
  let time = params.canvas.z;
  let usePerspective = params.reserved.x;
  let rotationSpeed = params.reserved.y;
  let fold = time * rotationSpeed;
  var p = hypercubeVertex(index);

  let rotatedXw = rot2(fold) * vec2f(p.x, p.w);
  p.x = rotatedXw.x;
  p.w = rotatedXw.y;

  let rotatedYz = rot2(-0.52) * vec2f(p.y, p.z);
  p.y = rotatedYz.x;
  p.z = rotatedYz.y;

  p += params.translation;

  let wPerspective = 4.6;
  let wDepthPerspective = 1.0 / max(1.6, wPerspective - p.w);
  let wDepth = mix(0.34, wDepthPerspective, usePerspective);
  var q = p.xyz * wDepth;

  let rotatedXz = rot2(0.78) * vec2f(q.x, q.z);
  q.x = rotatedXz.x;
  q.z = rotatedXz.y;

  let rotatedYz2 = rot2(-0.38) * vec2f(q.y, q.z);
  q.y = rotatedYz2.x;
  q.z = rotatedYz2.y;

  let zPerspective = 3.8;
  let zDepthPerspective = 1.0 / max(1.2, zPerspective - q.z);
  let zDepth = mix(0.86, zDepthPerspective, usePerspective);
  let stretch = vec2f(mix(1.28, 2.08, usePerspective), mix(1.28, 2.08, usePerspective));
  return q.xy * zDepth * stretch;
}

fn latticeField(pos : vec2f) -> vec4f {
  var edgeDist = 10.0;
  var vertexDist = 10.0;

  for (var i = 0u; i < 16u; i = i + 1u) {
    let pi = projectVertex(i);
    let pv = length(pos - pi);
    vertexDist = min(vertexDist, pv);
    for (var j = i + 1u; j < 16u; j = j + 1u) {
      if (countOneBits(i ^ j) != 1u) {
        continue;
      }
      let pj = projectVertex(j);
      let segmentDist = sdSegment(pos, pi, pj);
      edgeDist = min(edgeDist, segmentDist);
    }
  }
  return vec4f(edgeDist, vertexDist, 0.0, 0.0);
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );
  let pos = positions[vertexIndex];
  var out : VertexOut;
  out.position = vec4f(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  return out;
}

@fragment
fn fsMain(in : VertexOut) -> @location(0) vec4f {
  let resolution = max(params.canvas.xy, vec2f(1.0, 1.0));
  let aspect = resolution.x / resolution.y;
  var pos = in.uv * 2.0 - 1.0;
  pos.x *= aspect;

  let field = latticeField(pos);
  let pixel = 2.0 / min(resolution.x, resolution.y);
  let lineWidth = pixel * 0.58;
  let aaWidth = pixel * 0.72;
  let edgeLine = 1.0 - smoothstep(lineWidth, lineWidth + aaWidth, field.x);
  let vertexLine = 1.0 - smoothstep(pixel * 1.2, pixel * 2.0, field.y);

  let base = vec3f(3.0 / 255.0, 8.0 / 255.0, 14.0 / 255.0);
  let lineColor = vec3f(126.0 / 255.0, 214.0 / 255.0, 242.0 / 255.0) * 0.84;
  let color = mix(base, lineColor, max(edgeLine, vertexLine * 0.65));
  return vec4f(color, 1.0);
}
