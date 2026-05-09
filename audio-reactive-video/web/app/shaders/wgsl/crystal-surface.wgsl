struct CrystalParams {
  canvas : vec4f,
  crystal : vec4f,
  dynamics : vec4f,
  lowColor : vec4f,
  midColor : vec4f,
  highColor : vec4f,
  harmony : vec4f,
  pitches0 : vec4f,
  pitches1 : vec4f,
  pitches2 : vec4f,
};

struct VertexOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@group(0) @binding(0) var<uniform> params : CrystalParams;

fn saturate(value : f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn pitchValue(index : i32) -> f32 {
  if (index < 4) {
    return params.pitches0[index];
  }
  if (index < 8) {
    return params.pitches1[index - 4];
  }
  return params.pitches2[index - 8];
}

fn pitchProfile(pos : vec2f) -> f32 {
  var accum = 0.0;
  var weight = 0.0;
  for (var index : i32 = 0; index < 12; index += 1) {
    let angle = f32(index) / 12.0 * 6.2831853 - 1.5707963;
    let ringRadius = select(0.24, 0.42, index % 2 == 0);
    let node = vec2f(cos(angle), sin(angle)) * ringRadius;
    let d = length(pos - node);
    let influence = exp(-d * d * 20.0);
    let strength = pitchValue(index);
    accum += strength * influence;
    weight += influence;
  }
  return accum / max(weight, 1e-4);
}

fn rotate2(vector : vec2f, angle : f32) -> vec2f {
  let s = sin(angle);
  let c = cos(angle);
  return vec2f(vector.x * c - vector.y * s, vector.x * s + vector.y * c);
}

fn hexFacet(pos : vec2f) -> f32 {
  let p = abs(pos);
  return max(dot(p, normalize(vec2f(1.0, 1.7320508))), p.x);
}

fn triLattice(pos : vec2f, angle : f32, scale : f32) -> vec3f {
  let dir0 = rotate2(normalize(vec2f(1.0, 0.0)), angle);
  let dir1 = rotate2(normalize(vec2f(0.5, 0.8660254)), angle);
  let dir2 = rotate2(normalize(vec2f(-0.5, 0.8660254)), angle);
  return vec3f(
    cos(dot(pos, dir0) * scale),
    cos(dot(pos, dir1) * scale),
    cos(dot(pos, dir2) * scale)
  );
}

fn prismaticFlow(pos : vec2f, angle : f32, scale : f32, time : f32) -> vec3f {
  let dir0 = rotate2(normalize(vec2f(1.0, 0.0)), angle);
  let dir1 = rotate2(normalize(vec2f(0.5, 0.8660254)), angle);
  let dir2 = rotate2(normalize(vec2f(-0.5, 0.8660254)), angle);
  return vec3f(
    sin(dot(pos, dir0) * scale + time),
    sin(dot(pos, dir1) * scale - time * 0.86),
    sin(dot(pos, dir2) * scale + time * 1.12)
  );
}

fn crystalField(pos : vec2f) -> f32 {
  let time = params.canvas.z;
  let centerAngle = atan2(params.harmony.y, params.harmony.x);
  let harmonicTilt = clamp(length(params.harmony.xy), 0.0, 1.0);
  let coherence = params.harmony.z;
  let orientationDrift = centerAngle * harmonicTilt * (0.1 + coherence * 0.08);
  let latticeAngle = centerAngle * harmonicTilt * (0.14 + coherence * 0.1);
  let rotated = rotate2(pos, orientationDrift);
  let drift = params.crystal.y * 0.75;
  let latticeScale = 9.5 + params.crystal.z * 2.6;
  let tonalBias = params.crystal.x;
  let latticeVec = triLattice(rotated, latticeAngle, latticeScale);
  let facetCoords = rotate2(
    rotated + vec2f(0.18, -0.14) * harmonicTilt + vec2f(-0.12, 0.09) * coherence,
    latticeAngle * 0.6,
  );
  let lattice = (
    cos(acos(latticeVec.x) + time * (0.08 + params.crystal.y * 0.14) + drift) +
    cos(acos(latticeVec.y) - time * (0.06 + params.crystal.y * 0.1) + tonalBias * 0.12) +
    cos(acos(latticeVec.z) + time * (0.05 + params.crystal.y * 0.08) - tonalBias * 0.1)
  ) / 3.0;
  let facet = 1.0 - smoothstep(0.2, 0.78, fract(hexFacet(facetCoords * (2.6 + harmonicTilt * 1.1))) );
  let ridgeCarrier = triLattice(rotated * (1.0 + harmonicTilt * 0.1), latticeAngle, latticeScale * (0.82 + coherence * 0.12));
  let ridgeSeed = max(max(abs(ridgeCarrier.x), abs(ridgeCarrier.y)), abs(ridgeCarrier.z));
  let ridge = 1.0 - smoothstep(0.84 - coherence * 0.06, 0.98, ridgeSeed);
  let membrane = smoothstep(
    -0.36 - params.crystal.z * 0.1 - coherence * 0.08,
    0.82 + params.crystal.z * 0.08 + coherence * 0.12,
    lattice
  );
  let pitchLift = pitchProfile(rotated);
  let centerLift = exp(-dot(rotated, rotated) * mix(3.2, 5.0, params.crystal.z * 0.62 + coherence * 0.2))
    * (0.035 + params.crystal.w * 0.015 + coherence * 0.02);
  let ribbon = sin((rotated.x - rotated.y) * (4.3 + params.crystal.y * 1.5 + harmonicTilt * 0.8) - time * (0.06 + params.crystal.y * 0.08)) * 0.5 + 0.5;
  return membrane * (0.64 + params.crystal.z * 0.12 + coherence * 0.14)
    + pitchLift * (0.28 + tonalBias * 0.14 + harmonicTilt * 0.08)
    + centerLift * 0.045
    + ribbon * 0.018
    + facet * 0.08 * (0.4 + coherence * 0.6)
    + ridge * (0.06 + coherence * 0.08);
}

fn surfaceNormal(pos : vec2f) -> vec3f {
  let eps = 0.005;
  let hx = crystalField(pos + vec2f(eps, 0.0)) - crystalField(pos - vec2f(eps, 0.0));
  let hy = crystalField(pos + vec2f(0.0, eps)) - crystalField(pos - vec2f(0.0, eps));
  return normalize(vec3f(-hx * 2.2, -hy * 2.2, 1.0));
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  var out : VertexOut;
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );
  let clip = positions[vertexIndex];
  out.position = vec4f(clip, 0.0, 1.0);
  out.uv = clip * 0.5 + 0.5;
  return out;
}

@fragment
fn fsMain(@location(0) uv : vec2f) -> @location(0) vec4f {
  let aspect = max(params.canvas.x / max(params.canvas.y, 1.0), 1e-4);
  var pos = uv * 2.0 - 1.0;
  pos.x *= aspect;

  let mask = 1.0 - smoothstep(0.18, 1.08, length(pos));
  let field = crystalField(pos);
  let normal = surfaceNormal(pos);
  let coherence = params.harmony.z;
  let harmonicTilt = clamp(length(params.harmony.xy), 0.0, 1.0);
  let centerAngle = atan2(params.harmony.y, params.harmony.x);
  let orientationDrift = centerAngle * harmonicTilt * (0.1 + coherence * 0.08);
  let latticeAngle = centerAngle * harmonicTilt * (0.14 + coherence * 0.1);
  let rotated = rotate2(pos, orientationDrift);
  let rmsPulse = smoothstep(0.08, 0.34, params.canvas.w);
  let bandPulse = smoothstep(0.12, 0.42, max(params.dynamics.y, params.dynamics.z));
  let structuralPulse = max(rmsPulse, bandPulse);
  let facetCoords = rotate2(
    rotated + vec2f(0.18, -0.14) * harmonicTilt + vec2f(-0.12, 0.09) * coherence,
    latticeAngle * 0.6,
  );
  let flowVec = prismaticFlow(
    rotated * (1.0 + harmonicTilt * 0.08),
    latticeAngle,
    (6.2 + params.crystal.y * 2.4 + harmonicTilt * 2.0),
    params.canvas.z * (0.16 + params.crystal.y * 0.16)
  );
  let lightDir = normalize(vec3f(-0.42, -0.35, 0.84));
  let rimDir = normalize(vec3f(0.46, -0.18, 0.72));
  let diffuse = saturate(dot(normal, lightDir));
  let rim = pow(1.0 - saturate(dot(normal, rimDir)), 2.4);
  let facetMeasure = hexFacet(facetCoords * (2.6 + harmonicTilt * 1.0));
  let facetBand = 1.0 - smoothstep(0.1, 0.26 + (1.0 - coherence) * 0.06, abs(fract(facetMeasure) - 0.5));
  let flowBand = max(max(flowVec.x, flowVec.y), flowVec.z);
  let linkTexture = saturate(facetBand * 0.58 + smoothstep(0.4, 0.94, flowBand) * 0.42);
  let linkPulse = structuralPulse * linkTexture;
  let seam = pow(facetBand, 1.8) * (0.09 + coherence * 0.12 + linkPulse * 0.1);
  let internalFlow = smoothstep(0.32, 0.98, flowBand) * (0.075 + params.crystal.y * 0.08 + harmonicTilt * 0.03 + linkPulse * 0.03);
  let internalCore = exp(-dot(rotated, rotated) * (3.8 - coherence * 0.24)) * (0.03 + params.crystal.w * 0.025);

  let lowMid = mix(params.lowColor.rgb, params.midColor.rgb, saturate(field * (0.24 + params.crystal.x * 0.14) + harmonicTilt * 0.08));
  let palette = mix(lowMid, params.highColor.rgb, saturate(field * 0.16 + harmonicTilt * 0.14 + coherence * 0.04));
  let shadow = mix(vec3f(4.0, 8.0, 12.0), palette * 0.22, 0.58);
  let body = mix(shadow, palette, saturate(field * (0.6 + params.crystal.z * 0.12 + coherence * 0.1) + diffuse * 0.38));
  let crest = palette * (0.6 + params.crystal.w * 0.14 + coherence * 0.06) + params.highColor.rgb * rim * (0.04 + params.crystal.w * 0.045);
  var color = mix(body, crest, saturate(diffuse * 0.52 + rim * 0.42 + coherence * 0.08));
  let sheen = pow(saturate(diffuse), 5.8) * (0.045 + params.crystal.w * 0.07 + coherence * 0.06);
  color += params.highColor.rgb * sheen * (0.1 + params.crystal.w * 0.06 + harmonicTilt * 0.05);
  color += params.highColor.rgb * seam * (0.1 + params.crystal.w * 0.07);
  color = mix(color, color * (0.94 + coherence * 0.03), facetBand * 0.16);
  color += mix(params.midColor.rgb, params.highColor.rgb, 0.5 + harmonicTilt * 0.08) * internalFlow * (0.022 + params.crystal.w * 0.024);
  color += params.highColor.rgb * internalCore * internalFlow * (0.014 + params.crystal.w * 0.014);
  color = mix(color, color + params.highColor.rgb * 0.012, linkPulse * 0.6);

  let grain = sin((pos.x + pos.y) * 19.0 + params.canvas.z * 0.05) * 0.5 + 0.5;
  color = mix(color, color + palette * 0.04, grain * 0.06 * params.dynamics.z * (0.6 + params.crystal.y * 0.4));
  color = mix(vec3f(3.0, 6.0, 9.0), color, mask);
  return vec4f(clamp(color / 255.0, vec3f(0.0), vec3f(1.0)), 1.0);
}
