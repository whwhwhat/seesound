import {
  fieldSize,
} from "./constants.js";

const gpuShadePipeline = {
  program: null,
  positionBuffer: null,
  ditherTexture: null,
  attribs: null,
  uniforms: null,
  uploadedDither: false,
  available: false,
};

const gpuFieldValidation = {
  frame: 0,
  lastComparedFrame: -1,
  maxAbsDiff: 0,
  meanAbsDiff: 0,
};

const gpuFieldPipeline = {
  gl: null,
  available: false,
  program: null,
  positionBuffer: null,
  framebuffer: null,
  outputTexture: null,
  colorAccumTexture: null,
  colorWeightTexture: null,
  sharpAtlasTexture: null,
  blurredAtlasTexture: null,
  modeStateTexture: null,
  attribs: null,
  uniforms: null,
  uploadedSpatialKey: "",
  outputInternalFormat: 0,
  outputType: 0,
};

const GPU_FIELD_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const GPU_FIELD_FRAGMENT_SHADER = `#version 300 es
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
`;

const GPU_SHADE_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const GPU_SHADE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D u_fieldTex;
uniform sampler2D u_colorAccumTex;
uniform sampler2D u_colorWeightTex;
uniform sampler2D u_ditherTex;
uniform vec2 u_texel;
uniform float u_displayScale;
uniform float u_rms;
uniform float u_centroid;
uniform float u_contrast;
uniform float u_coreSharpness;
uniform float u_haloSharpness;
uniform float u_lineWeight;
uniform float u_haloWeight;
uniform float u_backgroundWeight;
uniform float u_singleAmpGate;
uniform float u_separation;
uniform float u_renderDormant;
uniform float u_shapeMode;
uniform float u_useGlowColor;
uniform float u_glowThickness;
uniform float u_glowSpread;
uniform float u_atmosphereEnabled;
uniform vec3 u_baseBgColor;
uniform vec3 u_backdropColor;
uniform vec3 u_baseColor;
uniform vec3 u_lineColor;
uniform vec3 u_outerColor;
uniform vec3 u_glowColor;
uniform vec3 u_atmosphereCore;
uniform vec3 u_atmosphereOuter;

in vec2 v_uv;
out vec4 outColor;

float clamp01(float value) {
  return clamp(value, 0.0, 1.0);
}

float sampleField(vec2 uv) {
  return texture(u_fieldTex, uv).r;
}

void main() {
  float value = sampleField(v_uv) / max(u_displayScale, 1e-6);
  vec2 centered = v_uv - vec2(0.5);
  float distanceToCenter = length(centered);
  float radius = distanceToCenter / 0.72;
  float mask = u_shapeMode > 0.5
    ? 1.0 - smoothstep(0.5 - 2.5 / 384.0, 0.5 + 1.5 / 384.0, distanceToCenter)
    : max(0.0, 1.0 - radius * radius);

  float edgeX = abs(value - sampleField(v_uv + vec2(u_texel.x, 0.0)) / max(u_displayScale, 1e-6));
  float edgeY = abs(value - sampleField(v_uv + vec2(0.0, u_texel.y)) / max(u_displayScale, 1e-6));
  float gradient = min(1.0, (edgeX + edgeY) * 2.6);
  float absValue = abs(value);
  float thicknessNorm = clamp(u_glowThickness / 4.0, 0.1, 2.4);
  float spreadNorm = clamp(u_glowSpread / 2.5, 0.08, 4.0);
  float nodeCore = u_renderDormant > 0.5 ? 0.0 : exp(-absValue * (u_coreSharpness / thicknessNorm));
  float nodeHalo = u_renderDormant > 0.5 ? 0.0 : exp(-absValue * (u_haloSharpness / max(0.35, spreadNorm)));
  float outerHalo = u_renderDormant > 0.5 ? 0.0 : exp(-absValue * (u_haloSharpness / max(0.22, spreadNorm * 1.45)));
  float lineStrength = nodeCore * (u_lineWeight + gradient * 1.25) * u_singleAmpGate;
  float haloStrength = nodeHalo * (u_haloWeight + gradient * 0.22) * u_singleAmpGate;
  float glowStrength = outerHalo * (0.06 + spreadNorm * 0.025 + u_singleAmpGate * 0.05);
  float displacement = pow(min(1.0, absValue), u_contrast);
  float backgroundField = displacement * u_backgroundWeight * u_singleAmpGate;
  float brightness = min(1.0, (lineStrength + haloStrength + glowStrength + backgroundField) * mask);
  float warm = min(1.0, brightness * (0.7 + u_centroid * 0.55));
  float cool = min(1.0, (gradient * 0.28 + u_rms * 0.18 + nodeHalo * 0.12 + outerHalo * 0.03) * mask);
  float dither = texture(u_ditherTex, v_uv).r;
  float warmD = clamp01(warm + dither * 0.7);
  float brightD = clamp01(brightness + dither);
  float coolD = clamp01(cool + dither * 0.55);
  float atmosphereMix =
    u_atmosphereEnabled > 0.5
      ? (1.0 - smoothstep(0.06, 0.48, distanceToCenter)) * (0.14 + brightness * 0.1)
      : 0.0;
  float atmosphereEdge =
    u_atmosphereEnabled > 0.5
      ? (1.0 - smoothstep(0.18, 0.52, distanceToCenter)) * 0.08
      : 0.0;

  vec3 color = vec3(
    u_baseBgColor.r + warmD * u_backdropColor.r * 0.82 + brightD * u_baseColor.r * 0.12,
    u_baseBgColor.g + brightD * u_backdropColor.g * 0.84 + lineStrength * u_lineColor.g * 0.12,
    u_baseBgColor.b + coolD * u_backdropColor.b * 0.92 + lineStrength * u_lineColor.b * 0.1
  );
  color += u_atmosphereCore * atmosphereMix + u_atmosphereOuter * atmosphereEdge;
  color += u_outerColor * glowStrength * 0.14;
  color += u_glowColor * glowStrength * (0.08 + spreadNorm * 0.015);

  if (u_useGlowColor > 0.5) {
    vec3 accum = texture(u_colorAccumTex, v_uv).rgb;
    float weight = texture(u_colorWeightTex, v_uv).r;
    if (weight > 1e-6) {
      vec3 avgColor = accum / weight;
      float monoLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float avgLuma = dot(avgColor, vec3(0.2126, 0.7152, 0.0722));
      float luminanceScale = monoLuma / max(avgLuma, 1.0);
      vec3 tinted = clamp(avgColor * luminanceScale, 0.0, 255.0);
      vec3 boostedTint = vec3(
        clamp(tinted.r * (0.98 - u_separation * 0.06), 0.0, 255.0),
        clamp(tinted.g * (1.0 + u_separation * 0.03), 0.0, 255.0),
        clamp(tinted.b * (1.03 + u_separation * 0.16), 0.0, 255.0)
      );
      float tintMix = clamp(
        0.18 + u_separation * 0.16
        + lineStrength * (0.96 + u_separation * 0.22)
        + haloStrength * (0.64 + u_separation * 0.16)
        + backgroundField * (0.34 + u_separation * 0.08),
        0.0,
        0.98
      );
      color = mix(color, boostedTint, tintMix);
    }
  }

  outColor = vec4(clamp(color / 255.0, 0.0, 1.0), mask);
}
`;

export {
  GPU_FIELD_FRAGMENT_SHADER,
  GPU_FIELD_VERTEX_SHADER,
  GPU_SHADE_FRAGMENT_SHADER,
  GPU_SHADE_VERTEX_SHADER,
  gpuFieldPipeline,
  gpuFieldValidation,
  gpuShadePipeline,
};
