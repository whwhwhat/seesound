struct FieldParams {
  modeCount : u32,
  singleMode : u32,
  signedMode : u32,
  useGlowColor : u32,
};

struct ModeState {
  primary : vec4f,
  color : vec4f,
};

struct FieldOut {
  @location(0) field : vec4f,
  @location(1) colorAccum : vec4f,
  @location(2) colorWeight : vec4f,
};

@group(0) @binding(0) var sharpAtlas : texture_2d_array<f32>;
@group(0) @binding(1) var blurredAtlas : texture_2d_array<f32>;
@group(0) @binding(2) var<storage, read> modeStates : array<ModeState, 48>;
@group(0) @binding(3) var<uniform> params : FieldParams;

@fragment
fn main(@builtin(position) position : vec4f) -> FieldOut {
  let texel = vec2i(position.xy);
  var fieldValue = 0.0;
  var colorAccum = vec3f(0.0);
  var colorWeight = 0.0;

  for (var index : u32 = 0u; index < params.modeCount; index += 1u) {
    let mode = modeStates[index];
    if (mode.primary.x < 0.5) {
      continue;
    }
    let contribution = mode.primary.y;
    let sharpMix = mode.primary.z;
    let blurMix = mode.primary.w;
    let sharpValue = textureLoad(sharpAtlas, texel, i32(index), 0).x;
    let blurredValue = textureLoad(blurredAtlas, texel, i32(index), 0).x;
    let spatialValue = sharpValue * sharpMix + blurredValue * blurMix;
    let signedContribution = spatialValue * contribution;
    let resolvedContribution =
      select(abs(signedContribution), signedContribution, params.singleMode == 1u || params.signedMode == 1u);
    fieldValue += resolvedContribution;

    if (params.useGlowColor == 1u) {
      let weight = abs(resolvedContribution);
      colorAccum += mode.color.rgb * weight;
      colorWeight += weight;
    }
  }

  var out : FieldOut;
  out.field = vec4f(fieldValue, 0.0, 0.0, 1.0);
  out.colorAccum = vec4f(colorAccum, 1.0);
  out.colorWeight = vec4f(colorWeight, 0.0, 0.0, 1.0);
  return out;
}
