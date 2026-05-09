#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler2D;

#define MAX_MODES 48

uniform sampler2DArray u_sharpAtlas;
uniform sampler2DArray u_blurredAtlas;
uniform sampler2D u_modeState;
uniform int u_modeCount;
uniform int u_singleMode;
uniform int u_signedMode;
uniform int u_useGlowColor;

in vec2 v_uv;
layout(location = 0) out vec4 outField;
layout(location = 1) out vec4 outColorAccum;
layout(location = 2) out vec4 outColorWeight;

float modeStateValue(int index, int column) {
  vec2 uv = vec2((float(column) + 0.5) / 8.0, (float(index) + 0.5) / float(MAX_MODES));
  return texture(u_modeState, uv).r;
}

void main() {
  float fieldValue = 0.0;
  vec3 colorAccum = vec3(0.0);
  float colorWeight = 0.0;
  for (int index = 0; index < MAX_MODES; index += 1) {
    if (index >= u_modeCount) {
      break;
    }
    float enabled = modeStateValue(index, 0);
    if (enabled < 0.5) {
      continue;
    }
    float contribution = modeStateValue(index, 1);
    float sharpMix = modeStateValue(index, 2);
    float blurMix = modeStateValue(index, 3);
    float sharpValue = texture(u_sharpAtlas, vec3(v_uv, float(index))).r;
    float blurredValue = texture(u_blurredAtlas, vec3(v_uv, float(index))).r;
    float spatialValue = sharpValue * sharpMix + blurredValue * blurMix;
    float signedContribution = spatialValue * contribution;
    float resolvedContribution = (u_singleMode == 1 || u_signedMode == 1) ? signedContribution : abs(signedContribution);
    fieldValue += resolvedContribution;
    if (u_useGlowColor == 1) {
      float weight = abs(resolvedContribution);
      vec3 modeColor = vec3(
        modeStateValue(index, 4),
        modeStateValue(index, 5),
        modeStateValue(index, 6)
      );
      colorAccum += modeColor * weight;
      colorWeight += weight;
    }
  }
  outField = vec4(fieldValue, 0.0, 0.0, 1.0);
  outColorAccum = vec4(colorAccum, 1.0);
  outColorWeight = vec4(colorWeight, 0.0, 0.0, 1.0);
}
