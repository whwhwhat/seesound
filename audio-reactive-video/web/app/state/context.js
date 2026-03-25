const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const wgpuCanvas = document.getElementById("previewWgpu");
const glCanvas = document.getElementById("previewGl");
const audio = document.getElementById("audio");
const fileInput = document.getElementById("audioFile");
const statusNode = document.getElementById("status");
const plateShapeButtons = Array.from(document.getElementById("plateShape").querySelectorAll("button[data-shape]"));
const angularRotationWrap = document.getElementById("angularRotationWrap");
const renderStyleButtons = Array.from(document.getElementById("renderStyle").querySelectorAll("button[data-render-style]"));
const frameRateLimitButtons = Array.from(document.getElementById("frameRateLimit").querySelectorAll("button[data-frame-rate]"));
const atmosphereWrap = document.getElementById("atmosphereWrap");
const atmosphereEnabledInput = document.getElementById("atmosphereEnabled");
const glowThicknessWrap = document.getElementById("glowThicknessWrap");
const glowSpreadWrap = document.getElementById("glowSpreadWrap");
const colorSeparationWrap = document.getElementById("colorSeparationWrap");
const adaptiveColorMixWrap = document.getElementById("adaptiveColorMixWrap");
const themeWrap = document.getElementById("themeWrap");
const lowColorWrap = document.getElementById("lowColorWrap");
const midColorWrap = document.getElementById("midColorWrap");
const highColorWrap = document.getElementById("highColorWrap");
const themeSelect = document.getElementById("themeSelect");
const lowColorInput = document.getElementById("lowColor");
const midColorInput = document.getElementById("midColor");
const highColorInput = document.getElementById("highColor");
const displayModeButtons = Array.from(document.getElementById("displayMode").querySelectorAll("button[data-mode]"));
const combineModeWrap = document.getElementById("combineModeWrap");
const combineModeSelect = document.getElementById("combineMode");
const singleModeWrap = document.getElementById("singleModeWrap");
const modeLabel = document.getElementById("modeLabel");
const bandLabel = document.getElementById("bandLabel");
const singleModeViewWrap = document.getElementById("singleModeViewWrap");
const singleModeViewButtons = Array.from(document.getElementById("singleModeView").querySelectorAll("button[data-single-view]"));
const nodalFocusWrap = document.getElementById("nodalFocusWrap");
const contrastWrap = document.getElementById("contrastWrap");
const singleModeIndexOutput = document.querySelector('output[for="singleModeIndex"]');

const controlIds = [
  "glowThickness",
  "glowSpread",
  "colorSeparation",
  "adaptiveColorMix",
  "angularRotation",
  "singleModeIndex",
  "modeCount",
  "coupling",
  "persistence",
  "nodalFocus",
  "contrast",
  "motion",
];

const numericControls = {};
const controls = Object.fromEntries(
  controlIds.map((id) => {
    const input = document.getElementById(id);
    const output = document.querySelector(`output[for="${id}"]`);
    const sync = () => {
      output.value = input.value;
      output.textContent = input.value;
      numericControls[id] = Number.parseFloat(input.value);
    };
    input.addEventListener("input", sync);
    sync();
    return [id, input];
  }),
);

const fieldSize = 384;
const FFT_SIZE = 2048;
const BESSEL_ZEROS = {
  0: [2.4048, 5.5201, 8.6537],
  1: [3.8317, 7.0156, 10.1735],
  2: [5.1356, 8.4172, 11.6198],
  3: [6.3802, 9.761, 13.0152],
  4: [7.5883, 11.0647, 14.3725],
  5: [8.7715, 12.3386, 15.7002],
  6: [9.9361, 13.5893, 17.0038],
  7: [11.0864, 14.8213, 18.2883],
  8: [12.2251, 16.0378, 19.5576],
};
const THEME_PRESETS = {
  lab: {
    low: [108, 122, 43],
    mid: [188, 222, 72],
    high: [188, 244, 255],
  },
  amber: {
    low: [96, 56, 20],
    mid: [215, 144, 52],
    high: [255, 223, 168],
  },
  ice: {
    low: [28, 84, 88],
    mid: [102, 214, 220],
    high: [228, 250, 255],
  },
  heat: {
    low: [84, 18, 18],
    mid: [230, 96, 48],
    high: [255, 226, 126],
  },
  mono: {
    low: [76, 92, 82],
    mid: [160, 188, 168],
    high: [232, 240, 235],
  },
};
const BASE_BG_COLOR = [2, 6, 9];
const COLOR_FOCUS_LOW_HZ = 60;
const COLOR_FOCUS_HIGH_HZ = 6000;

const fieldCanvas = document.createElement("canvas");
fieldCanvas.width = fieldSize;
fieldCanvas.height = fieldSize;
const fieldCtx = fieldCanvas.getContext("2d");
const fieldImage = fieldCtx.createImageData(fieldSize, fieldSize);

const directGpuUnderlayCanvas = document.createElement("canvas");
directGpuUnderlayCanvas.width = fieldSize;
directGpuUnderlayCanvas.height = fieldSize;
const directGpuUnderlayCtx = directGpuUnderlayCanvas.getContext("2d");
const directGpuUnderlayImage = directGpuUnderlayCtx.createImageData(fieldSize, fieldSize);

const glowCanvas = document.createElement("canvas");
glowCanvas.width = 2048;
glowCanvas.height = 2048;
const glowCtx = glowCanvas.getContext("2d");

const fieldCellCount = fieldSize * fieldSize;
const fieldStride = fieldSize - 1;

const renderBuffers = {
  field: new Float32Array(fieldCellCount),
  colorWeight: new Float32Array(fieldCellCount),
  colorAccum: new Float32Array(fieldCellCount * 3),
  inactiveBands: new Float32Array(),
  modeContribution: new Float32Array(48),
  modeSharpMix: new Float32Array(48),
  modeBlurMix: new Float32Array(48),
  modeEnabled: new Uint8Array(48),
  modeColor: new Float32Array(48 * 3),
  gpuFieldReadback: new Float32Array(fieldCellCount * 4),
};

const fieldGeometry = {
  nx: new Float32Array(fieldCellCount),
  ny: new Float32Array(fieldCellCount),
  modeRadius: new Float32Array(fieldCellCount),
  circleInteriorMask: new Uint8Array(fieldCellCount),
  squareMask: new Float32Array(fieldCellCount),
  circleMask: new Float32Array(fieldCellCount),
  dither: new Float32Array(fieldCellCount),
};

const bandRangeCache = new Map();
const contourPathCache = {
  key: "",
  path: null,
};
const spatialAtlasCache = {
  key: "",
  sharp: new Float32Array(),
  blurred: new Float32Array(),
  modeCount: 0,
};
const spatialCache = new Map();

function readProfilePreference() {
  try {
    return window.localStorage.getItem("arv_profile") === "1";
  } catch {
    return false;
  }
}

function writeProfilePreference(enabled) {
  try {
    window.localStorage.setItem("arv_profile", enabled ? "1" : "0");
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

function readDirectGpuPreference() {
  try {
    return window.localStorage.getItem("arv_direct_gpu") === "1";
  } catch {
    return false;
  }
}

function writeDirectGpuPreference(enabled) {
  try {
    window.localStorage.setItem("arv_direct_gpu", enabled ? "1" : "0");
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

const rendererFlags = {
  directGpuPresentation:
    new URLSearchParams(window.location.search).get("directGpu") === "1" ||
    window.location.hash.includes("direct-gpu") ||
    readDirectGpuPreference(),
};

const profiler = {
  enabled:
    new URLSearchParams(window.location.search).get("profile") === "1" ||
    window.location.hash.includes("profile") ||
    readProfilePreference(),
  overlay: null,
  frameCount: 0,
  fps: 0,
  samples: Object.create(null),
  order: [
    "frame",
    "updateModeState",
    "webgpuField",
    "webgpuReduce",
    "webgpuShade",
    "gpuAccumulate",
    "gpuShade",
    "gpuReadback",
    "cpuAccumulate",
    "fieldPost",
    "cpuShade",
    "isoline",
    "glowContours",
    "composite",
  ],
};

const state = {
  audioContext: null,
  analyser: null,
  sourceNode: null,
  freqData: null,
  timeData: null,
  modeState: [],
  bandProfile: new Float32Array(),
  animationFrame: 0,
  isAnimating: false,
  lastAnimationTimestamp: 0,
  phase: 0,
  renderStyle: "glow",
  displayMode: "sum",
  combineMode: "signed",
  singleModeView: "amplitude",
  frameRateLimit: "auto",
  plateShape: "square",
  activeTheme: "lab",
  lowBandColor: [...THEME_PRESETS.lab.low],
  midBandColor: [...THEME_PRESETS.lab.mid],
  highBandColor: [...THEME_PRESETS.lab.high],
  currentAudioObjectUrl: null,
};

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
  BASE_BG_COLOR,
  BESSEL_ZEROS,
  COLOR_FOCUS_HIGH_HZ,
  COLOR_FOCUS_LOW_HZ,
  FFT_SIZE,
  GPU_FIELD_FRAGMENT_SHADER,
  GPU_FIELD_VERTEX_SHADER,
  GPU_SHADE_FRAGMENT_SHADER,
  GPU_SHADE_VERTEX_SHADER,
  THEME_PRESETS,
  adaptiveColorMixWrap,
  angularRotationWrap,
  atmosphereEnabledInput,
  atmosphereWrap,
  audio,
  bandLabel,
  bandRangeCache,
  canvas,
  colorSeparationWrap,
  combineModeSelect,
  combineModeWrap,
  controls,
  contourPathCache,
  contrastWrap,
  ctx,
  directGpuUnderlayCanvas,
  directGpuUnderlayCtx,
  directGpuUnderlayImage,
  displayModeButtons,
  fieldCanvas,
  fieldCellCount,
  fieldCtx,
  fieldGeometry,
  fieldImage,
  fieldSize,
  fieldStride,
  fileInput,
  frameRateLimitButtons,
  glCanvas,
  glowCanvas,
  glowCtx,
  glowSpreadWrap,
  glowThicknessWrap,
  gpuFieldPipeline,
  gpuFieldValidation,
  gpuShadePipeline,
  highColorInput,
  highColorWrap,
  lowColorInput,
  lowColorWrap,
  midColorInput,
  midColorWrap,
  modeLabel,
  nodalFocusWrap,
  numericControls,
  plateShapeButtons,
  profiler,
  renderBuffers,
  rendererFlags,
  renderStyleButtons,
  singleModeIndexOutput,
  singleModeViewButtons,
  singleModeViewWrap,
  singleModeWrap,
  spatialAtlasCache,
  spatialCache,
  state,
  statusNode,
  themeSelect,
  themeWrap,
  wgpuCanvas,
  writeDirectGpuPreference,
  writeProfilePreference,
};
