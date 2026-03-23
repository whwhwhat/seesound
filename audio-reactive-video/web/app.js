const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const audio = document.getElementById("audio");
const fileInput = document.getElementById("audioFile");
const statusNode = document.getElementById("status");
const plateShapeRoot = document.getElementById("plateShape");
const plateShapeButtons = Array.from(plateShapeRoot.querySelectorAll("button[data-shape]"));
const angularRotationWrap = document.getElementById("angularRotationWrap");
const renderStyleRoot = document.getElementById("renderStyle");
const renderStyleButtons = Array.from(renderStyleRoot.querySelectorAll("button[data-render-style]"));
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
const displayModeRoot = document.getElementById("displayMode");
const displayModeButtons = Array.from(displayModeRoot.querySelectorAll("button[data-mode]"));
const combineModeWrap = document.getElementById("combineModeWrap");
const combineModeSelect = document.getElementById("combineMode");
const singleModeWrap = document.getElementById("singleModeWrap");
const modeLabel = document.getElementById("modeLabel");
const bandLabel = document.getElementById("bandLabel");
const singleModeViewWrap = document.getElementById("singleModeViewWrap");
const singleModeViewRoot = document.getElementById("singleModeView");
const singleModeViewButtons = Array.from(singleModeViewRoot.querySelectorAll("button[data-single-view]"));
const nodalFocusWrap = document.getElementById("nodalFocusWrap");
const contrastWrap = document.getElementById("contrastWrap");
const singleModeIndexOutput = document.querySelector('output[for="singleModeIndex"]');
const numericControls = {};

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

for (const id of controlIds) {
  controls[id].addEventListener("input", () => {
    requestRender();
  });
}

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
const gpuFieldCanvas = document.createElement("canvas");
gpuFieldCanvas.width = fieldSize;
gpuFieldCanvas.height = fieldSize;
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
uniform vec3 u_baseBgColor;
uniform vec3 u_backdropColor;
uniform vec3 u_baseColor;
uniform vec3 u_lineColor;
uniform vec3 u_outerColor;
uniform vec3 u_glowColor;

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
  float nodeCore = u_renderDormant > 0.5 ? 0.0 : exp(-absValue * u_coreSharpness);
  float nodeHalo = u_renderDormant > 0.5 ? 0.0 : exp(-absValue * u_haloSharpness);
  float lineStrength = nodeCore * (u_lineWeight + gradient * 1.25) * u_singleAmpGate;
  float haloStrength = nodeHalo * (u_haloWeight + gradient * 0.22) * u_singleAmpGate;
  float displacement = pow(min(1.0, absValue), u_contrast);
  float backgroundField = displacement * u_backgroundWeight * u_singleAmpGate;
  float brightness = min(1.0, (lineStrength + haloStrength + backgroundField) * mask);
  float warm = min(1.0, brightness * (0.7 + u_centroid * 0.55));
  float cool = min(1.0, (gradient * 0.28 + u_rms * 0.18 + nodeHalo * 0.12) * mask);
  float dither = texture(u_ditherTex, v_uv).r;
  float warmD = clamp01(warm + dither * 0.7);
  float brightD = clamp01(brightness + dither);
  float coolD = clamp01(cool + dither * 0.55);

  vec3 color = vec3(
    u_baseBgColor.r + warmD * u_backdropColor.r * 0.82 + brightD * u_baseColor.r * 0.12,
    u_baseBgColor.g + brightD * u_backdropColor.g * 0.84 + lineStrength * u_lineColor.g * 0.12,
    u_baseBgColor.b + coolD * u_backdropColor.b * 0.92 + lineStrength * u_lineColor.b * 0.1
  );

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

  outColor = vec4(color / 255.0, mask);
}
`;

let audioContext = null;
let analyser = null;
let sourceNode = null;
let freqData = null;
let timeData = null;
let modeState = [];
let bandProfile = new Float32Array();
let animationFrame = 0;
let isAnimating = false;
let phase = 0;
let renderStyle = "glow";
let displayMode = "sum";
let combineMode = "signed";
let singleModeView = "amplitude";
let plateShape = "square";
let activeTheme = "lab";
let lowBandColor = [...THEME_PRESETS.lab.low];
let midBandColor = [...THEME_PRESETS.lab.mid];
let highBandColor = [...THEME_PRESETS.lab.high];

const spatialCache = new Map();

function initializeFieldGeometry() {
  let ptr = 0;
  for (let y = 0; y < fieldSize; y += 1) {
    const nyField = y / fieldStride - 0.5;
    const nyMode = (y / fieldStride) * 2 - 1;
    for (let x = 0; x < fieldSize; x += 1) {
      const nxField = x / fieldStride - 0.5;
      const nxMode = (x / fieldStride) * 2 - 1;
      const distance = Math.sqrt(nxField * nxField + nyField * nyField);
      const modeRadius = Math.sqrt(nxMode * nxMode + nyMode * nyMode);
      const radius = distance / 0.72;
      fieldGeometry.nx[ptr] = nxMode;
      fieldGeometry.ny[ptr] = nyMode;
      fieldGeometry.modeRadius[ptr] = modeRadius;
      fieldGeometry.circleInteriorMask[ptr] = modeRadius <= 1 ? 1 : 0;
      fieldGeometry.squareMask[ptr] = Math.max(0, 1 - radius * radius);
      fieldGeometry.circleMask[ptr] = 1 - smoothstep(0.5 - 2.5 / fieldSize, 0.5 + 1.5 / fieldSize, distance);
      fieldGeometry.dither[ptr] = (noise2D(x + 17, y + 29) - 0.5) * 0.018;
      ptr += 1;
    }
  }
}

function getBandRanges(groups, sampleRate) {
  const key = `${groups}:${sampleRate}`;
  if (bandRangeCache.has(key)) {
    return bandRangeCache.get(key);
  }

  const minBin = 2;
  const maxBin = FFT_SIZE / 2 - 1;
  const hzPerBin = sampleRate / FFT_SIZE;
  const ranges = Array.from({ length: groups }, (_, groupIndex) => {
    const startT = groupIndex / groups;
    const endT = (groupIndex + 1) / groups;
    const start = Math.floor(minBin * Math.pow(maxBin / minBin, startT));
    const end = Math.max(start + 1, Math.floor(minBin * Math.pow(maxBin / minBin, endT)));
    return {
      start,
      end,
      lowHz: start * hzPerBin,
      highHz: Math.min((end + 1) * hzPerBin, sampleRate / 2),
    };
  });
  bandRangeCache.set(key, ranges);
  return ranges;
}

function ensureInactiveBands(targetCount) {
  if (renderBuffers.inactiveBands.length !== targetCount) {
    renderBuffers.inactiveBands = new Float32Array(targetCount);
  } else {
    renderBuffers.inactiveBands.fill(0);
  }
  return renderBuffers.inactiveBands;
}

function resetRenderBuffers() {
  renderBuffers.field.fill(0);
  renderBuffers.colorWeight.fill(0);
  renderBuffers.colorAccum.fill(0);
  renderBuffers.modeContribution.fill(0);
  renderBuffers.modeSharpMix.fill(0);
  renderBuffers.modeBlurMix.fill(0);
  renderBuffers.modeEnabled.fill(0);
  renderBuffers.modeColor.fill(0);
}

function createGlShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || "GPU shader compilation failed");
  }
  return shader;
}

function createGlProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = createGlShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createGlShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(message || "GPU program link failed");
  }
  return program;
}

function ensureGpuFieldPipeline() {
  if (gpuFieldPipeline.available) {
    return true;
  }
  if (gpuFieldPipeline.gl && !gpuFieldPipeline.available) {
    return false;
  }

  const gl = gpuFieldCanvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
  });
  gpuFieldPipeline.gl = gl;
  if (!gl) {
    return false;
  }

  try {
    const colorBufferFloatExt = gl.getExtension("EXT_color_buffer_float");
    if (!colorBufferFloatExt) {
      console.warn("GPU field pipeline unavailable: EXT_color_buffer_float missing");
      gpuFieldPipeline.available = false;
      return false;
    }

    const program = createGlProgram(gl, GPU_FIELD_VERTEX_SHADER, GPU_FIELD_FRAGMENT_SHADER);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );

    const framebuffer = gl.createFramebuffer();
    const outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, outputTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, null);

    const colorAccumTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, colorAccumTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, null);

    const colorWeightTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, colorWeightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, null);

    const sharpAtlasTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, sharpAtlasTexture);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const blurredAtlasTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, blurredAtlasTexture);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const modeStateTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, modeStateTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 8, 48, 0, gl.RED, gl.FLOAT, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, colorAccumTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, colorWeightTexture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);

    gpuFieldPipeline.program = program;
    gpuFieldPipeline.positionBuffer = positionBuffer;
    gpuFieldPipeline.framebuffer = framebuffer;
    gpuFieldPipeline.outputTexture = outputTexture;
    gpuFieldPipeline.colorAccumTexture = colorAccumTexture;
    gpuFieldPipeline.colorWeightTexture = colorWeightTexture;
    gpuFieldPipeline.sharpAtlasTexture = sharpAtlasTexture;
    gpuFieldPipeline.blurredAtlasTexture = blurredAtlasTexture;
    gpuFieldPipeline.modeStateTexture = modeStateTexture;
    gpuFieldPipeline.attribs = {
      position: gl.getAttribLocation(program, "a_position"),
    };
    gpuFieldPipeline.uniforms = {
      sharpAtlas: gl.getUniformLocation(program, "u_sharpAtlas"),
      blurredAtlas: gl.getUniformLocation(program, "u_blurredAtlas"),
      modeState: gl.getUniformLocation(program, "u_modeState"),
      modeCount: gl.getUniformLocation(program, "u_modeCount"),
      singleMode: gl.getUniformLocation(program, "u_singleMode"),
      signedMode: gl.getUniformLocation(program, "u_signedMode"),
      useGlowColor: gl.getUniformLocation(program, "u_useGlowColor"),
    };
    gpuFieldPipeline.outputInternalFormat = gl.RGBA32F;
    gpuFieldPipeline.outputType = gl.FLOAT;
    gpuFieldPipeline.available = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (gpuFieldPipeline.available) {
      console.log("GPU field pipeline ready");
    } else {
      console.warn("GPU field pipeline framebuffer incomplete");
    }
    return gpuFieldPipeline.available;
  } catch (error) {
    console.warn("GPU field pipeline unavailable", error);
    gpuFieldPipeline.available = false;
    return false;
  }
}

function ensureGpuShadePipeline() {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  if (gpuShadePipeline.available) {
    return true;
  }

  const gl = gpuFieldPipeline.gl;
  try {
    const program = createGlProgram(gl, GPU_SHADE_VERTEX_SHADER, GPU_SHADE_FRAGMENT_SHADER);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
      ]),
      gl.STATIC_DRAW,
    );

    const ditherTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, ditherTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gpuShadePipeline.program = program;
    gpuShadePipeline.positionBuffer = positionBuffer;
    gpuShadePipeline.ditherTexture = ditherTexture;
    gpuShadePipeline.attribs = {
      position: gl.getAttribLocation(program, "a_position"),
    };
    gpuShadePipeline.uniforms = {
      fieldTex: gl.getUniformLocation(program, "u_fieldTex"),
      colorAccumTex: gl.getUniformLocation(program, "u_colorAccumTex"),
      colorWeightTex: gl.getUniformLocation(program, "u_colorWeightTex"),
      ditherTex: gl.getUniformLocation(program, "u_ditherTex"),
      texel: gl.getUniformLocation(program, "u_texel"),
      displayScale: gl.getUniformLocation(program, "u_displayScale"),
      rms: gl.getUniformLocation(program, "u_rms"),
      centroid: gl.getUniformLocation(program, "u_centroid"),
      contrast: gl.getUniformLocation(program, "u_contrast"),
      coreSharpness: gl.getUniformLocation(program, "u_coreSharpness"),
      haloSharpness: gl.getUniformLocation(program, "u_haloSharpness"),
      lineWeight: gl.getUniformLocation(program, "u_lineWeight"),
      haloWeight: gl.getUniformLocation(program, "u_haloWeight"),
      backgroundWeight: gl.getUniformLocation(program, "u_backgroundWeight"),
      singleAmpGate: gl.getUniformLocation(program, "u_singleAmpGate"),
      separation: gl.getUniformLocation(program, "u_separation"),
      renderDormant: gl.getUniformLocation(program, "u_renderDormant"),
      shapeMode: gl.getUniformLocation(program, "u_shapeMode"),
      useGlowColor: gl.getUniformLocation(program, "u_useGlowColor"),
      glowThickness: gl.getUniformLocation(program, "u_glowThickness"),
      glowSpread: gl.getUniformLocation(program, "u_glowSpread"),
      baseBgColor: gl.getUniformLocation(program, "u_baseBgColor"),
      backdropColor: gl.getUniformLocation(program, "u_backdropColor"),
      baseColor: gl.getUniformLocation(program, "u_baseColor"),
      lineColor: gl.getUniformLocation(program, "u_lineColor"),
      outerColor: gl.getUniformLocation(program, "u_outerColor"),
      glowColor: gl.getUniformLocation(program, "u_glowColor"),
    };
    gpuShadePipeline.available = true;
    return true;
  } catch (error) {
    console.warn("GPU shade pipeline unavailable", error);
    gpuShadePipeline.available = false;
    return false;
  }
}

function uploadDitherTexture() {
  if (!ensureGpuShadePipeline() || gpuShadePipeline.uploadedDither) {
    return gpuShadePipeline.available;
  }
  const gl = gpuFieldPipeline.gl;
  const ditherPixels = new Float32Array(fieldCellCount);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    ditherPixels[ptr] = fieldGeometry.dither[ptr];
  }
  gl.bindTexture(gl.TEXTURE_2D, gpuShadePipeline.ditherTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, fieldSize, fieldSize, 0, gl.RED, gl.FLOAT, ditherPixels);
  gpuShadePipeline.uploadedDither = true;
  return true;
}

function uploadSpatialAtlasToGpu(spatialAtlas) {
  if (!ensureGpuFieldPipeline()) {
    return false;
  }
  if (gpuFieldPipeline.uploadedSpatialKey === spatialAtlas.key) {
    return true;
  }

  const gl = gpuFieldPipeline.gl;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, gpuFieldPipeline.sharpAtlasTexture);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, fieldSize, fieldSize, spatialAtlas.modeCount, 0, gl.RED, gl.FLOAT, spatialAtlas.sharp);

  gl.bindTexture(gl.TEXTURE_2D_ARRAY, gpuFieldPipeline.blurredAtlasTexture);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, fieldSize, fieldSize, spatialAtlas.modeCount, 0, gl.RED, gl.FLOAT, spatialAtlas.blurred);

  gpuFieldPipeline.uploadedSpatialKey = spatialAtlas.key;
  return true;
}

function buildGpuModeStateTexture(modeRenderState) {
  const packed = new Float32Array(8 * 48);
  for (let index = 0; index < modeState.length; index += 1) {
    const offset = index * 8;
    packed[offset] = modeRenderState.enabled[index];
    packed[offset + 1] = modeRenderState.contribution[index];
    packed[offset + 2] = modeRenderState.sharpMix[index];
    packed[offset + 3] = modeRenderState.blurMix[index];
    packed[offset + 4] = modeRenderState.color[index * 3];
    packed[offset + 5] = modeRenderState.color[index * 3 + 1];
    packed[offset + 6] = modeRenderState.color[index * 3 + 2];
    packed[offset + 7] = 0;
  }
  return packed;
}

function runGpuFieldAccumulation(spatialAtlas, modeRenderState, isSingleMode, useGlowColor) {
  if (!uploadSpatialAtlasToGpu(spatialAtlas)) {
    return false;
  }

  const gl = gpuFieldPipeline.gl;
  const packedModeState = buildGpuModeStateTexture(modeRenderState);

  gl.bindTexture(gl.TEXTURE_2D, gpuFieldPipeline.modeStateTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 8, 48, 0, gl.RED, gl.FLOAT, packedModeState);

  gl.viewport(0, 0, fieldSize, fieldSize);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpuFieldPipeline.framebuffer);
  gl.useProgram(gpuFieldPipeline.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gpuFieldPipeline.positionBuffer);
  gl.enableVertexAttribArray(gpuFieldPipeline.attribs.position);
  gl.vertexAttribPointer(gpuFieldPipeline.attribs.position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, gpuFieldPipeline.sharpAtlasTexture);
  gl.uniform1i(gpuFieldPipeline.uniforms.sharpAtlas, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, gpuFieldPipeline.blurredAtlasTexture);
  gl.uniform1i(gpuFieldPipeline.uniforms.blurredAtlas, 1);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, gpuFieldPipeline.modeStateTexture);
  gl.uniform1i(gpuFieldPipeline.uniforms.modeState, 2);

  gl.uniform1i(gpuFieldPipeline.uniforms.modeCount, modeState.length);
  gl.uniform1i(gpuFieldPipeline.uniforms.singleMode, isSingleMode ? 1 : 0);
  gl.uniform1i(gpuFieldPipeline.uniforms.signedMode, combineMode === "signed" ? 1 : 0);
  gl.uniform1i(gpuFieldPipeline.uniforms.useGlowColor, useGlowColor ? 1 : 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

function shouldValidateGpuField() {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  if (gpuFieldValidation.lastComparedFrame < 0) {
    return true;
  }
  return gpuFieldValidation.frame - gpuFieldValidation.lastComparedFrame >= 120;
}

function validateGpuFieldAgainstCpu(cpuField) {
  if (!gpuFieldPipeline.available) {
    return;
  }
  const gl = gpuFieldPipeline.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpuFieldPipeline.framebuffer);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);

  let maxAbsDiff = 0;
  let totalAbsDiff = 0;
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const gpuValue = renderBuffers.gpuFieldReadback[ptr * 4];
    const diff = Math.abs(gpuValue - cpuField[ptr]);
    if (diff > maxAbsDiff) {
      maxAbsDiff = diff;
    }
    totalAbsDiff += diff;
  }

  gpuFieldValidation.lastComparedFrame = gpuFieldValidation.frame;
  gpuFieldValidation.maxAbsDiff = maxAbsDiff;
  gpuFieldValidation.meanAbsDiff = totalAbsDiff / Math.max(1, fieldCellCount);
  console.log("GPU field validation", {
    frame: gpuFieldValidation.frame,
    maxAbsDiff: gpuFieldValidation.maxAbsDiff,
    meanAbsDiff: gpuFieldValidation.meanAbsDiff,
  });
}

function readGpuFieldIntoCpuBuffer(targetField) {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  const gl = gpuFieldPipeline.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpuFieldPipeline.framebuffer);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    targetField[ptr] = renderBuffers.gpuFieldReadback[ptr * 4];
  }
  return true;
}

function readGpuGlowAccumulation(field, colorWeight, colorAccum) {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  const gl = gpuFieldPipeline.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpuFieldPipeline.framebuffer);

  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    field[ptr] = renderBuffers.gpuFieldReadback[ptr * 4];
  }

  gl.readBuffer(gl.COLOR_ATTACHMENT1);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const pixelIndex = ptr * 4;
    colorAccum[ptr * 3] = renderBuffers.gpuFieldReadback[pixelIndex];
    colorAccum[ptr * 3 + 1] = renderBuffers.gpuFieldReadback[pixelIndex + 1];
    colorAccum[ptr * 3 + 2] = renderBuffers.gpuFieldReadback[pixelIndex + 2];
  }

  gl.readBuffer(gl.COLOR_ATTACHMENT2);
  gl.readPixels(0, 0, fieldSize, fieldSize, gl.RGBA, gl.FLOAT, renderBuffers.gpuFieldReadback);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    colorWeight[ptr] = renderBuffers.gpuFieldReadback[ptr * 4];
  }

  return true;
}

function uploadFieldToGpuTextures(field, colorAccum, colorWeight) {
  if (!gpuFieldPipeline.available) {
    return false;
  }
  const gl = gpuFieldPipeline.gl;
  const rgba = renderBuffers.gpuFieldReadback;

  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const idx = ptr * 4;
    rgba[idx] = field[ptr];
    rgba[idx + 1] = 0;
    rgba[idx + 2] = 0;
    rgba[idx + 3] = 1;
  }
  gl.bindTexture(gl.TEXTURE_2D, gpuFieldPipeline.outputTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, rgba);

  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const idx = ptr * 4;
    rgba[idx] = colorAccum[ptr * 3];
    rgba[idx + 1] = colorAccum[ptr * 3 + 1];
    rgba[idx + 2] = colorAccum[ptr * 3 + 2];
    rgba[idx + 3] = 1;
  }
  gl.bindTexture(gl.TEXTURE_2D, gpuFieldPipeline.colorAccumTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, rgba);

  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const idx = ptr * 4;
    rgba[idx] = colorWeight[ptr];
    rgba[idx + 1] = 0;
    rgba[idx + 2] = 0;
    rgba[idx + 3] = 1;
  }
  gl.bindTexture(gl.TEXTURE_2D, gpuFieldPipeline.colorWeightTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fieldSize, fieldSize, 0, gl.RGBA, gl.FLOAT, rgba);

  return true;
}

function shadeFieldOnGpu(params) {
  if (!uploadDitherTexture()) {
    return false;
  }

  const gl = gpuFieldPipeline.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, fieldSize, fieldSize);
  gl.useProgram(gpuShadePipeline.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gpuShadePipeline.positionBuffer);
  gl.enableVertexAttribArray(gpuShadePipeline.attribs.position);
  gl.vertexAttribPointer(gpuShadePipeline.attribs.position, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gpuFieldPipeline.outputTexture);
  gl.uniform1i(gpuShadePipeline.uniforms.fieldTex, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gpuFieldPipeline.colorAccumTexture);
  gl.uniform1i(gpuShadePipeline.uniforms.colorAccumTex, 1);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, gpuFieldPipeline.colorWeightTexture);
  gl.uniform1i(gpuShadePipeline.uniforms.colorWeightTex, 2);

  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, gpuShadePipeline.ditherTexture);
  gl.uniform1i(gpuShadePipeline.uniforms.ditherTex, 3);

  gl.uniform2f(gpuShadePipeline.uniforms.texel, 1 / fieldSize, 1 / fieldSize);
  gl.uniform1f(gpuShadePipeline.uniforms.displayScale, params.displayScale);
  gl.uniform1f(gpuShadePipeline.uniforms.rms, params.rms);
  gl.uniform1f(gpuShadePipeline.uniforms.centroid, params.centroid);
  gl.uniform1f(gpuShadePipeline.uniforms.contrast, params.contrast);
  gl.uniform1f(gpuShadePipeline.uniforms.coreSharpness, params.coreSharpness);
  gl.uniform1f(gpuShadePipeline.uniforms.haloSharpness, params.haloSharpness);
  gl.uniform1f(gpuShadePipeline.uniforms.lineWeight, params.lineWeight);
  gl.uniform1f(gpuShadePipeline.uniforms.haloWeight, params.haloWeight);
  gl.uniform1f(gpuShadePipeline.uniforms.backgroundWeight, params.backgroundWeight);
  gl.uniform1f(gpuShadePipeline.uniforms.singleAmpGate, params.singleAmpGate);
  gl.uniform1f(gpuShadePipeline.uniforms.separation, params.separation);
  gl.uniform1f(gpuShadePipeline.uniforms.renderDormant, params.renderAsDormantSingle ? 1 : 0);
  gl.uniform1f(gpuShadePipeline.uniforms.shapeMode, plateShape === "circle" ? 1 : 0);
  gl.uniform1f(gpuShadePipeline.uniforms.useGlowColor, params.useGlowColor ? 1 : 0);
  gl.uniform1f(gpuShadePipeline.uniforms.glowThickness, params.glowThickness);
  gl.uniform1f(gpuShadePipeline.uniforms.glowSpread, params.glowSpread);
  gl.uniform3f(gpuShadePipeline.uniforms.baseBgColor, BASE_BG_COLOR[0], BASE_BG_COLOR[1], BASE_BG_COLOR[2]);
  gl.uniform3f(gpuShadePipeline.uniforms.backdropColor, params.themePalette.backdropColor[0], params.themePalette.backdropColor[1], params.themePalette.backdropColor[2]);
  gl.uniform3f(gpuShadePipeline.uniforms.baseColor, params.themePalette.baseColor[0], params.themePalette.baseColor[1], params.themePalette.baseColor[2]);
  gl.uniform3f(gpuShadePipeline.uniforms.lineColor, params.themePalette.lineColor[0], params.themePalette.lineColor[1], params.themePalette.lineColor[2]);
  gl.uniform3f(gpuShadePipeline.uniforms.outerColor, params.themePalette.outerColor[0], params.themePalette.outerColor[1], params.themePalette.outerColor[2]);
  gl.uniform3f(gpuShadePipeline.uniforms.glowColor, params.glowColor[0], params.glowColor[1], params.glowColor[2]);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return true;
}

function getSpatialAtlasKey() {
  const angularRotation = plateShape === "circle" ? numericControls.angularRotation.toFixed(2) : "0.00";
  return `${plateShape}:${angularRotation}:${modeState.length}`;
}

function ensureSpatialAtlas() {
  const key = getSpatialAtlasKey();
  if (spatialAtlasCache.key === key) {
    return spatialAtlasCache;
  }

  const modeCount = modeState.length;
  const atlasLength = fieldCellCount * modeCount;
  if (spatialAtlasCache.sharp.length !== atlasLength) {
    spatialAtlasCache.sharp = new Float32Array(atlasLength);
    spatialAtlasCache.blurred = new Float32Array(atlasLength);
  }

  for (let index = 0; index < modeCount; index += 1) {
    const mode = modeState[index];
    const spatial = getSpatialMode(mode.m, mode.n);
    spatialAtlasCache.sharp.set(spatial.sharp, index * fieldCellCount);
    spatialAtlasCache.blurred.set(spatial.blurred, index * fieldCellCount);
  }

  spatialAtlasCache.key = key;
  spatialAtlasCache.modeCount = modeCount;
  return spatialAtlasCache;
}

function buildModes(count) {
  if (plateShape === "circle") {
    return buildCircleModes(count);
  }
  return buildSquareModes(count);
}

function buildSquareModes(count) {
  const pairs = [];
  for (let order = 2; pairs.length < count * 2 && order <= 16; order += 1) {
    for (let m = 1; m < order; m += 1) {
      const n = order - m;
      if (m === n) {
        continue;
      }
      pairs.push([m, n]);
    }
  }

  const modes = [];
  for (let index = 0; index < count; index += 1) {
    const [m, n] = pairs[index % pairs.length];
    modes.push({
      m,
      n,
      phase: (index / Math.max(1, count)) * Math.PI * 2,
      bandBias: index / Math.max(1, count - 1),
      amp: 0,
      velocity: 0,
    });
  }
  return modes;
}

function buildCircleModes(count) {
  const pairs = [];
  for (let radial = 1; radial <= 3; radial += 1) {
    for (let angular = 0; angular <= 8; angular += 1) {
      if (!BESSEL_ZEROS[angular] || !BESSEL_ZEROS[angular][radial - 1]) {
        continue;
      }
      pairs.push({
        n: angular,
        m: radial,
        zero: BESSEL_ZEROS[angular][radial - 1],
      });
    }
  }
  pairs.sort((a, b) => a.zero - b.zero || a.n - b.n || a.m - b.m);

  const modes = [];
  for (let index = 0; index < count; index += 1) {
    const { n, m } = pairs[index % pairs.length];
    modes.push({
      n,
      m,
      phase: (index / Math.max(1, count)) * Math.PI * 2,
      bandBias: index / Math.max(1, count - 1),
      amp: 0,
      velocity: 0,
    });
  }
  return modes;
}

function blurField(values, width, height, radius = 2) {
  const temp = new Float32Array(values.length);
  const result = new Float32Array(values.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dx = -radius; dx <= radius; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) {
          continue;
        }
        sum += values[y * width + xx];
        count += 1;
      }
      temp[y * width + x] = sum / Math.max(1, count);
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          continue;
        }
        sum += temp[yy * width + x];
        count += 1;
      }
      result[y * width + x] = sum / Math.max(1, count);
    }
  }

  return result;
}

function getSpatialMode(m, n) {
  const angularRotation = plateShape === "circle"
    ? numericControls.angularRotation
    : 0;
  const key = `${plateShape}:${m}:${n}:${angularRotation.toFixed(2)}`;
  if (spatialCache.has(key)) {
    return spatialCache.get(key);
  }

  const sharp = new Float32Array(fieldSize * fieldSize);
  for (let ptr = 0; ptr < fieldCellCount; ptr += 1) {
    const nx = fieldGeometry.nx[ptr];
    const ny = fieldGeometry.ny[ptr];
    let mode = 0;
    if (plateShape === "circle") {
      const radius = fieldGeometry.modeRadius[ptr];
      if (radius <= 1) {
        const theta = Math.atan2(ny, nx);
        mode = circleModeValue(n, m, radius, theta, angularRotation);
      }
    } else {
      mode =
        Math.cos(n * Math.PI * nx) * Math.cos(m * Math.PI * ny) -
        Math.cos(m * Math.PI * nx) * Math.cos(n * Math.PI * ny);
    }
    sharp[ptr] = mode;
  }
  const blurred = blurField(sharp, fieldSize, fieldSize, 3);
  const bundle = { sharp, blurred };
  spatialCache.set(key, bundle);
  return bundle;
}

function factorial(value) {
  if (value <= 1) {
    return 1;
  }
  let result = 1;
  for (let index = 2; index <= value; index += 1) {
    result *= index;
  }
  return result;
}

function besselJ(order, x) {
  let sum = 0;
  for (let k = 0; k < 20; k += 1) {
    const numerator = Math.pow(-1, k) * Math.pow(x / 2, 2 * k + order);
    const denominator = factorial(k) * factorial(k + order);
    sum += numerator / denominator;
  }
  return sum;
}

function circleModeValue(n, m, radius, theta, angularRotationDegrees = 0) {
  const zeros = BESSEL_ZEROS[n];
  if (!zeros || !zeros[m - 1]) {
    return 0;
  }
  const znm = zeros[m - 1];
  const kr = znm * radius;
  const radial = besselJ(n, kr);
  const rotation = (angularRotationDegrees * Math.PI) / 180;
  const angular = Math.cos(n * theta - rotation);
  return radial * angular;
}

function updateModeLabel() {
  const singleModeIndex = Math.max(0, Math.min(modeState.length - 1, Math.round(numericControls.singleModeIndex) - 1));
  const mode = modeState[singleModeIndex];
  if (!mode) {
    modeLabel.textContent = "Mode pair: unavailable";
    bandLabel.textContent = "Drive band: unavailable";
    return;
  }
  if (plateShape === "circle") {
    modeLabel.textContent = `Mode pair: (n=${mode.n}, m=${mode.m})`;
  } else {
    modeLabel.textContent = `Mode pair: (m=${mode.m}, n=${mode.n})`;
  }
  const groups = Math.round(numericControls.modeCount);
  const sampleRate = audioContext?.sampleRate ?? 48000;
  const { lowHz, highHz } = getBandRange(singleModeIndex, groups, sampleRate);
  bandLabel.textContent = `Drive band: ${Math.round(lowHz)} - ${Math.round(highHz)} Hz`;
}

function syncControlVisibility() {
  const isGlow = renderStyle === "glow";
  const isSingle = displayMode === "single";
  const isCircle = plateShape === "circle";
  angularRotationWrap.classList.toggle("is-hidden", !isCircle);
  atmosphereWrap.classList.toggle("is-hidden", false);
  glowThicknessWrap.classList.toggle("is-hidden", !isGlow);
  glowSpreadWrap.classList.toggle("is-hidden", !isGlow);
  colorSeparationWrap.classList.toggle("is-hidden", !isGlow);
  adaptiveColorMixWrap.classList.toggle("is-hidden", !isGlow);
  themeWrap.classList.toggle("is-hidden", !isGlow);
  lowColorWrap.classList.toggle("is-hidden", !isGlow);
  midColorWrap.classList.toggle("is-hidden", !isGlow);
  highColorWrap.classList.toggle("is-hidden", !isGlow);
  nodalFocusWrap.classList.toggle("is-hidden", !isGlow);
  contrastWrap.classList.toggle("is-hidden", !isGlow);
  combineModeWrap.classList.toggle("is-hidden", isSingle);
  singleModeWrap.classList.toggle("is-hidden", !isSingle);
  modeLabel.classList.toggle("is-hidden", !isSingle);
  bandLabel.classList.toggle("is-hidden", !isSingle);
  singleModeViewWrap.classList.toggle("is-hidden", !isSingle);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerpColor(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function mixColor3(a, b, c, t) {
  if (t <= 0.5) {
    return lerpColor(a, b, t * 2);
  }
  return lerpColor(b, c, (t - 0.5) * 2);
}

function toRgba(color, alpha) {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`;
}

function rgbToHex(color) {
  return `#${color.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function syncThemeInputs() {
  lowColorInput.value = rgbToHex(lowBandColor);
  midColorInput.value = rgbToHex(midBandColor);
  highColorInput.value = rgbToHex(highBandColor);
  themeSelect.value = activeTheme;
}

function applyTheme(themeKey) {
  const preset = THEME_PRESETS[themeKey];
  if (!preset) {
    return;
  }
  activeTheme = themeKey;
  lowBandColor = [...preset.low];
  midBandColor = [...preset.mid];
  highBandColor = [...preset.high];
  syncThemeInputs();
}

function getBandRange(groupIndex, groups, sampleRate) {
  const ranges = getBandRanges(groups, sampleRate);
  return ranges[Math.max(0, Math.min(ranges.length - 1, groupIndex))];
}

function toMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}

function getModeBaseColor(groupIndex, groups, sampleRate, themePalette) {
  const adaptiveMix = numericControls.adaptiveColorMix;
  const separation = numericControls.colorSeparation;
  const { lowHz, highHz } = getBandRange(groupIndex, groups, sampleRate);
  const centerHz = Math.sqrt(Math.max(1, lowHz) * Math.max(1, highHz));
  const melMin = toMel(COLOR_FOCUS_LOW_HZ);
  const melMax = toMel(Math.min(sampleRate / 2, COLOR_FOCUS_HIGH_HZ));
  const melCenter = toMel(centerHz);
  const fixedT = clamp((melCenter - melMin) / Math.max(1e-6, melMax - melMin), 0, 1);
  let adaptiveT = fixedT;
  if (bandProfile.length === groups) {
    let total = 0;
    for (let index = 0; index < bandProfile.length; index += 1) {
      total += bandProfile[index];
    }
    if (total > 1e-6) {
      let cumulative = 0;
      for (let index = 0; index <= groupIndex; index += 1) {
        cumulative += bandProfile[index];
      }
      const lower = cumulative - bandProfile[groupIndex];
      adaptiveT = clamp((lower + bandProfile[groupIndex] * 0.5) / total, 0, 1);
    }
  }
  const t = lerp(fixedT, adaptiveT, adaptiveMix);
  const centerSpread = clamp((t - 0.5) * (0.7 + separation * 0.55) + 0.5, 0, 1);
  const eased = Math.pow(centerSpread, 0.78 - Math.min(0.18, separation * 0.08));
  const paletteColor = mixColor3(lowBandColor, midBandColor, highBandColor, eased);
  const neutralMix = clamp(0.42 - separation * 0.12, 0.04, 0.42);
  return lerpColor(themePalette.baseColor, paletteColor, 1 - neutralMix);
}

function getThemeLineColor() {
  return lerpColor(midBandColor, highBandColor, 0.35);
}

function getThemeGlowPalette() {
  const lineColor = getThemeLineColor();
  const baseColor = lerpColor(lineColor, highBandColor, 0.22);
  const outerColor = lerpColor(lowBandColor, lineColor, 0.5);
  const backdropColor = lerpColor(BASE_BG_COLOR, lineColor, 0.18);
  const atmosphereCore = lerpColor(BASE_BG_COLOR, lineColor, 0.16);
  const atmosphereOuter = lerpColor(BASE_BG_COLOR, outerColor, 0.1);
  return {
    lineColor,
    baseColor,
    outerColor,
    backdropColor,
    atmosphereCore,
    atmosphereOuter,
  };
}

function noise2D(x, y) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function percentileOfField(field, q, requireCircleInterior = false) {
  const values = [];
  for (let ptr = 0; ptr < field.length; ptr += 1) {
    if (requireCircleInterior && fieldGeometry.circleInteriorMask[ptr] === 0) {
      continue;
    }
    values.push(field[ptr]);
  }
  if (values.length === 0) {
    return 0;
  }
  values.sort((a, b) => a - b);
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * q)));
  return values[index];
}

function removeRadialAverage(field) {
  const bucketCount = Math.max(32, Math.floor(fieldSize * 0.7));
  const sums = new Float32Array(bucketCount);
  const counts = new Float32Array(bucketCount);

  for (let ptr = 0; ptr < field.length; ptr += 1) {
    const radius = Math.min(1, fieldGeometry.modeRadius[ptr]);
    const bucket = Math.min(bucketCount - 1, Math.floor(radius * (bucketCount - 1)));
    sums[bucket] += field[ptr];
    counts[bucket] += 1;
  }

  const averages = new Float32Array(bucketCount);
  for (let index = 0; index < bucketCount; index += 1) {
    averages[index] = counts[index] > 0 ? sums[index] / counts[index] : 0;
  }

  for (let ptr = 0; ptr < field.length; ptr += 1) {
    const radius = Math.min(1, fieldGeometry.modeRadius[ptr]);
    const bucket = Math.min(bucketCount - 1, Math.floor(radius * (bucketCount - 1)));
    field[ptr] -= averages[bucket];
  }
}

function interpolatePoint(ax, ay, av, bx, by, bv) {
  const denom = bv - av;
  const t = Math.abs(denom) < 1e-6 ? 0.5 : (0 - av) / denom;
  return [lerp(ax, bx, t), lerp(ay, by, t)];
}

function appendIsolineSegment(path, p0, p1, scale, inset, drawSize, smoothed) {
  const x0 = inset + (p0[0] / scale) * drawSize;
  const y0 = inset + (p0[1] / scale) * drawSize;
  const x1 = inset + (p1[0] / scale) * drawSize;
  const y1 = inset + (p1[1] / scale) * drawSize;
  if (!smoothed) {
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
    return;
  }
  const mx = (x0 + x1) * 0.5;
  const my = (y0 + y1) * 0.5;
  path.moveTo(x0, y0);
  path.quadraticCurveTo(mx, my, x1, y1);
}

function buildIsolinePath(field, displayScale, inset, drawSize, smoothed = false) {
  const normalizedScale = Math.max(displayScale, 1e-6);
  const path = new Path2D();
  const rimCutoff = plateShape === "circle" ? fieldSize * 0.015 : -1;
  for (let y = 0; y < fieldSize - 1; y += 1) {
    for (let x = 0; x < fieldSize - 1; x += 1) {
      if (rimCutoff > 0) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        const nx = (cx / (fieldSize - 1)) * 2 - 1;
        const ny = (cy / (fieldSize - 1)) * 2 - 1;
        const distanceToRim = 1 - Math.sqrt(nx * nx + ny * ny);
        if (distanceToRim < rimCutoff / fieldSize) {
          continue;
        }
      }
      const tl = field[y * fieldSize + x] / normalizedScale;
      const tr = field[y * fieldSize + x + 1] / normalizedScale;
      const br = field[(y + 1) * fieldSize + x + 1] / normalizedScale;
      const bl = field[(y + 1) * fieldSize + x] / normalizedScale;

      const points = [];
      if ((tl <= 0 && tr > 0) || (tl > 0 && tr <= 0)) {
        points.push(interpolatePoint(x, y, tl, x + 1, y, tr));
      }
      if ((tr <= 0 && br > 0) || (tr > 0 && br <= 0)) {
        points.push(interpolatePoint(x + 1, y, tr, x + 1, y + 1, br));
      }
      if ((br <= 0 && bl > 0) || (br > 0 && bl <= 0)) {
        points.push(interpolatePoint(x + 1, y + 1, br, x, y + 1, bl));
      }
      if ((bl <= 0 && tl > 0) || (bl > 0 && tl <= 0)) {
        points.push(interpolatePoint(x, y + 1, bl, x, y, tl));
      }

      if (points.length === 2) {
        const [p0, p1] = points;
        appendIsolineSegment(path, p0, p1, fieldStride, inset, drawSize, smoothed);
      } else if (points.length === 4) {
        const [p0, p1, p2, p3] = points;
        appendIsolineSegment(path, p0, p1, fieldStride, inset, drawSize, smoothed);
        appendIsolineSegment(path, p2, p3, fieldStride, inset, drawSize, smoothed);
      }
    }
  }
  return path;
}

function getIsolinePath(field, displayScale, inset, drawSize, smoothed = false) {
  const key = `${displayScale.toFixed(6)}:${inset.toFixed(3)}:${drawSize.toFixed(3)}:${smoothed ? 1 : 0}`;
  if (contourPathCache.key !== key) {
    contourPathCache.key = key;
    contourPathCache.path = buildIsolinePath(field, displayScale, inset, drawSize, smoothed);
  }
  return contourPathCache.path;
}

function strokePath(ctxTarget, path) {
  ctxTarget.beginPath();
  ctxTarget.stroke(path);
}

function drawIsolines(path, ampGate, inset, drawSize) {
  const thresholdAlpha = Math.max(0.12, ampGate);
  const lineColor = getThemeLineColor();
  const shadowColor = lerpColor(lineColor, highBandColor, 0.45);
  ctx.save();
  if (plateShape === "circle") {
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, drawSize / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.strokeStyle = toRgba(lineColor, 0.38 + thresholdAlpha * 0.52);
  ctx.lineWidth = 1.35 + thresholdAlpha * 1.15;
  ctx.shadowColor = toRgba(shadowColor, 0.22);
  ctx.shadowBlur = 8 + thresholdAlpha * 8;
  strokePath(ctx, path);
  ctx.restore();
}

function drawGlowContours(path, inset, drawSize, ampGate, glowColor, themePalette) {
  const alpha = Math.max(0.1, ampGate);
  const thickness = numericControls.glowThickness;
  const spread = numericControls.glowSpread;
  const separation = numericControls.colorSeparation;
  const glowSpread = Math.pow(spread, 0.7);
  const glowAlphaScale = 1 / Math.pow(thickness, 0.18);
  const outerGlowColor = lerpColor(themePalette.outerColor, glowColor, clamp(0.72 + separation * 0.12, 0, 1));
  const innerGlowColor = lerpColor(themePalette.baseColor, glowColor, clamp(0.9 + separation * 0.08, 0, 1));
  const lineColor = lerpColor(themePalette.baseColor, glowColor, 1);
  glowCtx.setTransform(1, 0, 0, 1, 0, 0);
  glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
  glowCtx.save();
  const scale = glowCanvas.width / canvas.width;
  glowCtx.scale(scale, scale);
  glowCtx.lineCap = "round";
  glowCtx.lineJoin = "round";
  if (plateShape === "circle") {
    glowCtx.beginPath();
    glowCtx.arc(canvas.width / 2, canvas.height / 2, drawSize / 2, 0, Math.PI * 2);
    glowCtx.clip();
  }

  glowCtx.save();
  glowCtx.strokeStyle = toRgba(outerGlowColor, (0.08 + alpha * 0.09) * glowAlphaScale);
  glowCtx.lineWidth = (10 + alpha * 8) * (0.9 + thickness * 0.42);
  glowCtx.filter = `blur(${((12 + alpha * 12) * glowSpread).toFixed(2)}px)`;
  strokePath(glowCtx, path);
  glowCtx.restore();

  glowCtx.save();
  glowCtx.strokeStyle = toRgba(innerGlowColor, (0.1 + alpha * 0.11) * glowAlphaScale);
  glowCtx.lineWidth = (4.4 + alpha * 2.4) * (0.92 + thickness * 0.32);
  glowCtx.filter = `blur(${((3.5 + alpha * 3.2) * glowSpread).toFixed(2)}px)`;
  strokePath(glowCtx, path);
  glowCtx.restore();

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.drawImage(glowCanvas, 0, 0, glowCanvas.width, glowCanvas.height, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  glowCtx.restore();

  ctx.save();
  if (plateShape === "circle") {
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, drawSize / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.strokeStyle = toRgba(lineColor, 0.32 + alpha * 0.34);
  ctx.lineWidth = (2.4 + alpha * 1.6) * (0.8 + thickness * 0.34);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokePath(ctx, path);
  ctx.restore();
}

function ensureAudioGraph() {
  if (audioContext) {
    return;
  }

  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.78;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  timeData = new Uint8Array(analyser.fftSize);

  sourceNode = audioContext.createMediaElementSource(audio);
  sourceNode.connect(analyser);
  analyser.connect(audioContext.destination);
  updateModeLabel();
}

function buildModeRenderState(sampleRate, themePalette, singleModeIndex, isSingleMode) {
  const modeContribution = renderBuffers.modeContribution;
  const modeSharpMix = renderBuffers.modeSharpMix;
  const modeBlurMix = renderBuffers.modeBlurMix;
  const modeEnabled = renderBuffers.modeEnabled;
  const modeColor = renderBuffers.modeColor;

  for (let index = 0; index < modeState.length; index += 1) {
    const mode = modeState[index];
    if (displayMode === "single" && index !== singleModeIndex) {
      continue;
    }

    const contribution =
      displayMode === "single" && singleModeView === "oscillation"
        ? mode.amp * Math.sin(phase * (1.1 + mode.bandBias * 2.4) + mode.phase)
        : mode.amp;
    const focus = Math.max(0, Math.min(1, Math.abs(contribution) * 1.6));
    const sharpMix = isSingleMode ? 1 : focus;
    const color = renderStyle === "glow" ? getModeBaseColor(index, modeState.length, sampleRate, themePalette) : null;

    modeContribution[index] = contribution;
    modeSharpMix[index] = sharpMix;
    modeBlurMix[index] = 1 - sharpMix;
    modeEnabled[index] = 1;
    if (color) {
      modeColor[index * 3] = color[0];
      modeColor[index * 3 + 1] = color[1];
      modeColor[index * 3 + 2] = color[2];
    }
  }

  return {
    contribution: modeContribution,
    sharpMix: modeSharpMix,
    blurMix: modeBlurMix,
    enabled: modeEnabled,
    color: modeColor,
  };
}

function groupBands(data, groups) {
  const values = new Float32Array(groups);
  const sampleRate = audioContext?.sampleRate ?? 48000;
  const ranges = getBandRanges(groups, sampleRate);

  for (let group = 0; group < groups; group += 1) {
    const { start, end } = ranges[group];
    let sum = 0;
    for (let index = start; index < end; index += 1) {
      sum += data[index] / 255;
    }
    values[group] = sum / Math.max(1, end - start);
  }

  return values;
}

function updateModeState() {
  const targetCount = Math.round(numericControls.modeCount);
  if (modeState.length !== targetCount) {
    modeState = buildModes(targetCount);
    bandProfile = new Float32Array(targetCount);
    controls.singleModeIndex.max = String(targetCount);
    if (Math.round(numericControls.singleModeIndex) > targetCount) {
      controls.singleModeIndex.value = String(targetCount);
      singleModeIndexOutput.value = controls.singleModeIndex.value;
      singleModeIndexOutput.textContent = controls.singleModeIndex.value;
      numericControls.singleModeIndex = targetCount;
    }
    updateModeLabel();
  }

  const isPlaying = Boolean(analyser) && !audio.paused && !audio.ended && audio.currentTime > 0;
  if (!analyser || !isPlaying) {
    return { bands: ensureInactiveBands(targetCount), rms: 0, centroid: 0, isPlaying: false };
  }

  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  const bands = groupBands(freqData, targetCount);
  if (bandProfile.length !== targetCount) {
    bandProfile = new Float32Array(targetCount);
  }
  for (let index = 0; index < targetCount; index += 1) {
    const smoothing = 0.025;
    bandProfile[index] = bandProfile[index] * (1 - smoothing) + bands[index] * smoothing;
  }
  let rmsAccum = 0;
  let centroidAccum = 0;
  let energyAccum = 0;

  for (let index = 0; index < timeData.length; index += 1) {
    const centered = (timeData[index] - 128) / 128;
    rmsAccum += centered * centered;
  }

  for (let index = 0; index < bands.length; index += 1) {
    const energy = bands[index];
    energyAccum += energy;
    centroidAccum += energy * (index + 1);
  }

  return {
    bands,
    rms: Math.sqrt(rmsAccum / timeData.length),
    centroid: energyAccum > 1e-6 ? centroidAccum / energyAccum / bands.length : 0,
    isPlaying: true,
  };
}

function renderField() {
  gpuFieldValidation.frame += 1;
  const coupling = numericControls.coupling;
  const persistence = numericControls.persistence;
  const nodalFocus = numericControls.nodalFocus;
  const contrast = numericControls.contrast;
  const motion = numericControls.motion;
  const { bands, rms, centroid, isPlaying } = updateModeState();
  const sampleRate = audioContext?.sampleRate ?? 48000;
  const data = fieldImage.data;
  const field = renderBuffers.field;
  const colorWeight = renderBuffers.colorWeight;
  const colorAccum = renderBuffers.colorAccum;
  resetRenderBuffers();
  contourPathCache.key = "";
  contourPathCache.path = null;
  const singleModeIndex = Math.max(0, Math.min(modeState.length - 1, Math.round(numericControls.singleModeIndex) - 1));
  const isSingleMode = displayMode === "single";
  const useGlowColor = renderStyle === "glow";
  const themePalette = getThemeGlowPalette();
  const useGpuFieldOutput = gpuFieldPipeline.available && (renderStyle === "isoline" || renderStyle === "glow");
  const canUseGpuFinalShade = true;
  const renderAsDormantScene = !isPlaying && audio.currentTime <= 0.001;
  let activeSingleAmp = 0;
  let sceneColorWeight = 0;
  const sceneColorAccum = [0, 0, 0];

  if (isPlaying) {
    phase += 0.01 + centroid * 0.08 + rms * motion * 0.03;
  }

  for (let index = 0; index < modeState.length; index += 1) {
    const mode = modeState[index];
    if (!isPlaying) {
      continue;
    }
    const bandValue = bands[index] || 0;
    const excitation = Math.pow(Math.max(0, bandValue), 1.35) * (0.4 + coupling * 1.3);
    const detune = Math.sin(phase * (0.6 + mode.bandBias * 1.8) + mode.phase) * motion * 0.06;
    mode.velocity = mode.velocity * persistence + (excitation - mode.amp) * (0.18 + coupling * 0.1);
    mode.amp = Math.max(0, mode.amp + mode.velocity + detune);
    mode.amp *= 0.985;
  }

  const spatialAtlas = ensureSpatialAtlas();
  const modeRenderState = buildModeRenderState(sampleRate, themePalette, singleModeIndex, isSingleMode);
  runGpuFieldAccumulation(spatialAtlas, modeRenderState, isSingleMode, useGlowColor);

  for (let index = 0; index < modeState.length; index += 1) {
    if (modeRenderState.enabled[index] === 0) {
      continue;
    }
    const modeContribution = modeRenderState.contribution[index];
    activeSingleAmp = Math.max(activeSingleAmp, Math.abs(modeContribution));
    if (useGlowColor) {
      const sceneWeight = Math.abs(modeContribution);
      sceneColorWeight += sceneWeight;
      sceneColorAccum[0] += modeRenderState.color[index * 3] * sceneWeight;
      sceneColorAccum[1] += modeRenderState.color[index * 3 + 1] * sceneWeight;
      sceneColorAccum[2] += modeRenderState.color[index * 3 + 2] * sceneWeight;
    }
  }

  if (useGpuFieldOutput) {
    if (useGlowColor) {
      readGpuGlowAccumulation(field, colorWeight, colorAccum);
    } else {
      readGpuFieldIntoCpuBuffer(field);
    }
  } else {
    for (let index = 0; index < modeState.length; index += 1) {
      const mode = modeState[index];
      const spatial = getSpatialMode(mode.m, mode.n);
      if (modeRenderState.enabled[index] === 0) {
        continue;
      }
      const modeContribution = modeRenderState.contribution[index];
      const sharpMix = modeRenderState.sharpMix[index];
      const blurredMix = modeRenderState.blurMix[index];
      const modeColor = useGlowColor
        ? [
          modeRenderState.color[index * 3],
          modeRenderState.color[index * 3 + 1],
          modeRenderState.color[index * 3 + 2],
        ]
        : null;
      for (let ptr = 0; ptr < field.length; ptr += 1) {
        const spatialValue = spatial.sharp[ptr] * sharpMix + spatial.blurred[ptr] * blurredMix;
        const signedContribution = spatialValue * modeContribution;
        const contribution =
          displayMode === "single" || combineMode === "signed"
            ? signedContribution
            : Math.abs(signedContribution);
        field[ptr] += contribution;
        if (modeColor) {
          const weight = Math.abs(contribution);
          colorWeight[ptr] += weight;
          colorAccum[ptr * 3] += modeColor[0] * weight;
          colorAccum[ptr * 3 + 1] += modeColor[1] * weight;
          colorAccum[ptr * 3 + 2] += modeColor[2] * weight;
        }
      }
    }
  }

  if (!useGpuFieldOutput && shouldValidateGpuField()) {
    validateGpuFieldAgainstCpu(field);
  }

  if (displayMode !== "single" && combineMode !== "signed") {
    if (combineMode === "residual") {
      if (plateShape === "circle") {
        removeRadialAverage(field);
      } else {
        let meanField = 0;
        for (let ptr = 0; ptr < field.length; ptr += 1) {
          meanField += field[ptr];
        }
        meanField /= Math.max(1, field.length);
        for (let ptr = 0; ptr < field.length; ptr += 1) {
          field[ptr] -= meanField;
        }
      }
    } else if (combineMode === "percentile") {
      const threshold = percentileOfField(
        field,
        plateShape === "circle" ? 0.74 : 0.7,
        plateShape === "circle",
      );
      for (let ptr = 0; ptr < field.length; ptr += 1) {
        field[ptr] -= threshold;
      }
    }
  }

  let maxAbs = 1e-6;
  for (let ptr = 0; ptr < field.length; ptr += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(field[ptr]));
  }

  const singleAmpGate = isSingleMode ? Math.min(1, activeSingleAmp * 1.6) : 1;
  const singleAmpFloor = isSingleMode ? 0.0015 : 0;
  const renderAsDormantSingle = isSingleMode && activeSingleAmp < singleAmpFloor;
  const renderAsDormantField = renderAsDormantScene || renderAsDormantSingle;
  const displayScale = isSingleMode ? 1 : maxAbs;
  const singleFocus = isSingleMode ? Math.max(0, Math.min(1, singleAmpGate)) : 1;
  const coreSharpness = isSingleMode
    ? (3 + singleFocus * 27) * nodalFocus
    : 26 * nodalFocus;
  const haloSharpness = isSingleMode
    ? (0.8 + singleFocus * 7.2) * nodalFocus
    : 8 * nodalFocus;
  const lineWeight = isSingleMode
    ? 0.04 + singleFocus * 1.78
    : 0.55;
  const haloWeight = isSingleMode
    ? 0.62 - singleFocus * 0.34
    : 0.18;
  const backgroundWeight = isSingleMode
    ? 0.03 + (1 - singleFocus) * 0.18
    : 0.12;
  const singleModeBlur = isSingleMode ? (1 - singleFocus) * 12 : 0;
  const averageGlowColor =
    sceneColorWeight > 1e-6
      ? [
        sceneColorAccum[0] / sceneColorWeight,
        sceneColorAccum[1] / sceneColorWeight,
        sceneColorAccum[2] / sceneColorWeight,
      ]
      : themePalette.baseColor;
  const separation = numericControls.colorSeparation;
  const glowColor = lerpColor(themePalette.baseColor, averageGlowColor, clamp(0.78 + separation * 0.14, 0, 1));
  let baseImageSource = fieldCanvas;
  let didShadeOnGpu = false;
  const isSignedMode = displayMode === "single" || combineMode === "signed";
  const fieldWasModified = !isSignedMode;
  
  if (canUseGpuFinalShade && renderStyle === "glow") {
    if (fieldWasModified) {
      uploadFieldToGpuTextures(field, colorAccum, colorWeight);
    }
    
    didShadeOnGpu = shadeFieldOnGpu({
      rms,
      centroid,
      displayScale,
      contrast,
      coreSharpness,
      haloSharpness,
      lineWeight,
      haloWeight,
      backgroundWeight,
      singleAmpGate,
      separation,
      renderAsDormantSingle: renderAsDormantField,
      useGlowColor,
      glowThickness: numericControls.glowThickness,
      glowSpread: numericControls.glowSpread,
      glowColor,
      themePalette,
    });
    if (didShadeOnGpu) {
      baseImageSource = gpuFieldCanvas;
    }
  }

  if (!didShadeOnGpu) {
    let ptr = 0;
    const shapeMask = plateShape === "circle" ? fieldGeometry.circleMask : fieldGeometry.squareMask;
    for (let y = 0; y < fieldSize; y += 1) {
      for (let x = 0; x < fieldSize; x += 1) {
        const mask = shapeMask[ptr];
        const value = field[ptr] / Math.max(displayScale, 1e-6);
        const edgeX = x < fieldSize - 1 ? Math.abs(field[ptr] - field[ptr + 1]) : 0;
        const edgeY = y < fieldSize - 1 ? Math.abs(field[ptr] - field[ptr + fieldSize]) : 0;
        const gradient = Math.min(1, (edgeX + edgeY) / Math.max(displayScale, 1e-6) * 2.6);
        const nodeCore = renderAsDormantField ? 0 : Math.exp(-Math.abs(value) * coreSharpness);
        const nodeHalo = renderAsDormantField ? 0 : Math.exp(-Math.abs(value) * haloSharpness);
        const lineStrength = nodeCore * (lineWeight + gradient * 1.25) * singleAmpGate;
        const haloStrength = nodeHalo * (haloWeight + gradient * 0.22) * singleAmpGate;
        const displacement = Math.pow(Math.min(1, Math.abs(value)), contrast);
        const backgroundField = displacement * backgroundWeight * singleAmpGate;
        const brightness = Math.min(1, (lineStrength + haloStrength + backgroundField) * mask);
        const warm = Math.min(1, brightness * (0.7 + centroid * 0.55));
        const cool = Math.min(1, (gradient * 0.28 + rms * 0.18 + nodeHalo * 0.12) * mask);
        const dither = fieldGeometry.dither[ptr];
        const warmD = Math.min(1, Math.max(0, warm + dither * 0.7));
        const brightD = Math.min(1, Math.max(0, brightness + dither));
        const coolD = Math.min(1, Math.max(0, cool + dither * 0.55));

        let red =
          BASE_BG_COLOR[0] +
          warmD * themePalette.backdropColor[0] * 0.82 +
          brightD * themePalette.baseColor[0] * 0.12;
        let green =
          BASE_BG_COLOR[1] +
          brightD * themePalette.backdropColor[1] * 0.84 +
          lineStrength * themePalette.lineColor[1] * 0.12;
        let blue =
          BASE_BG_COLOR[2] +
          coolD * themePalette.backdropColor[2] * 0.92 +
          lineStrength * themePalette.lineColor[2] * 0.1;

        if (useGlowColor && colorWeight[ptr] > 1e-6) {
          const weight = colorWeight[ptr];
          const avgColor = [
            colorAccum[ptr * 3] / weight,
            colorAccum[ptr * 3 + 1] / weight,
            colorAccum[ptr * 3 + 2] / weight,
          ];
          const monoLuma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
          const avgLuma = avgColor[0] * 0.2126 + avgColor[1] * 0.7152 + avgColor[2] * 0.0722;
          const luminanceScale = monoLuma / Math.max(avgLuma, 1);
          const tinted = [
            clamp(avgColor[0] * luminanceScale, 0, 255),
            clamp(avgColor[1] * luminanceScale, 0, 255),
            clamp(avgColor[2] * luminanceScale, 0, 255),
          ];
          const boostedTint = [
            clamp(tinted[0] * (0.98 - separation * 0.06), 0, 255),
            clamp(tinted[1] * (1 + separation * 0.03), 0, 255),
            clamp(tinted[2] * (1.03 + separation * 0.16), 0, 255),
          ];
          const tintMix = clamp(
            0.18 + separation * 0.16 + lineStrength * (0.96 + separation * 0.22) + haloStrength * (0.64 + separation * 0.16) + backgroundField * (0.34 + separation * 0.08),
            0,
            0.98,
          );
          red = lerp(red, boostedTint[0], tintMix);
          green = lerp(green, boostedTint[1], tintMix);
          blue = lerp(blue, boostedTint[2], tintMix);
        }

        data[ptr * 4] = Math.round(red);
        data[ptr * 4 + 1] = Math.round(green);
        data[ptr * 4 + 2] = Math.round(blue);
        data[ptr * 4 + 3] = Math.round(mask * 255);
        ptr += 1;
      }
    }
    fieldCtx.putImageData(fieldImage, 0, 0);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = toRgba(BASE_BG_COLOR, 1);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rotateCircleSigned = plateShape === "circle" && combineMode === "signed";
  if (rotateCircleSigned) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
  }

  if (atmosphereEnabledInput.checked) {
    const gradient = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.06,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.48,
    );
    gradient.addColorStop(0, toRgba(themePalette.atmosphereCore, 0.22));
    gradient.addColorStop(0.45, toRgba(themePalette.atmosphereOuter, 0.11));
    gradient.addColorStop(1, toRgba(BASE_BG_COLOR, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const inset = canvas.width * 0.09;
  const drawSize = canvas.width - inset * 2;
  const smoothedIsolinePath =
    renderStyle === "glow" || renderStyle === "isoline"
      ? getIsolinePath(field, displayScale, inset, drawSize, true)
      : null;
  if (renderStyle === "glow") {
    ctx.save();
    if (plateShape === "circle") {
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, drawSize / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.shadowColor = toRgba(themePalette.outerColor, 0.08);
    ctx.shadowBlur = 10;
    ctx.imageSmoothingEnabled = true;
    const glowBlur = 0.45 + singleModeBlur * 0.6;
    ctx.filter = `blur(${glowBlur.toFixed(2)}px)`;
    ctx.globalAlpha = 0.18;
    ctx.drawImage(baseImageSource, inset, inset, drawSize, drawSize);
    ctx.restore();
    drawGlowContours(smoothedIsolinePath, inset, drawSize, singleAmpGate, glowColor, themePalette);
  } else {
    ctx.save();
    ctx.shadowColor = toRgba(themePalette.outerColor, 0.12);
    ctx.shadowBlur = 14;
    ctx.imageSmoothingEnabled = true;
    ctx.filter = "none";
    ctx.globalAlpha = atmosphereEnabledInput.checked ? 0.14 : 0.07;
    ctx.drawImage(baseImageSource, inset, inset, drawSize, drawSize);
    ctx.restore();
  }

  if (renderStyle === "isoline") {
    drawIsolines(smoothedIsolinePath, singleAmpGate, inset, drawSize);
  }

  if (plateShape === "circle") {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const outerRadius = drawSize / 2;
    const ringWidth = Math.max(10, canvas.width * 0.01);
    const innerRadius = outerRadius - ringWidth;
    const ringGradient = ctx.createRadialGradient(centerX, centerY, innerRadius, centerX, centerY, outerRadius);
    ringGradient.addColorStop(0, toRgba(BASE_BG_COLOR, 0));
    ringGradient.addColorStop(0.35, toRgba(BASE_BG_COLOR, 0.12));
    ringGradient.addColorStop(0.75, toRgba(BASE_BG_COLOR, 0.56));
    ringGradient.addColorStop(1, toRgba(BASE_BG_COLOR, 0.98));

    ctx.save();
    ctx.fillStyle = ringGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
    ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.restore();
  }

  ctx.strokeStyle = toRgba(themePalette.outerColor, 0.18);
  ctx.lineWidth = 2;
  if (plateShape !== "circle") {
    ctx.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
  }
  if (rotateCircleSigned) {
    ctx.restore();
  }
}

function requestRender() {
  if (isAnimating || animationFrame) {
    return;
  }
  animationFrame = window.requestAnimationFrame(() => {
    animationFrame = 0;
    renderField();
  });
}

function tick() {
  if (!isAnimating) {
    animationFrame = 0;
    return;
  }
  renderField();
  animationFrame = window.requestAnimationFrame(tick);
}

function startAnimationLoop() {
  if (isAnimating) {
    return;
  }
  isAnimating = true;
  if (animationFrame) {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
  animationFrame = window.requestAnimationFrame(tick);
}

function stopAnimationLoop() {
  isAnimating = false;
  if (animationFrame) {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
}

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files || [];
  if (!file) {
    return;
  }
  ensureAudioGraph();
  const objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  audio.load();
  statusNode.textContent = `Loaded ${file.name}. Press play to drive the field.`;
  requestRender();
});

plateShapeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    plateShape = button.dataset.shape === "circle" ? "circle" : "square";
    modeState = buildModes(Math.round(numericControls.modeCount));
    bandProfile = new Float32Array(modeState.length);
    updateModeLabel();
    plateShapeButtons.forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    statusNode.textContent =
      plateShape === "circle"
        ? "Showing circular Bessel-mode resonance fields."
        : "Showing square Chladni-mode resonance fields.";
    requestRender();
  });
});

renderStyleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    renderStyle = button.dataset.renderStyle === "isoline" ? "isoline" : "glow";
    renderStyleButtons.forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    syncControlVisibility();
    statusNode.textContent =
      renderStyle === "isoline"
        ? "Showing extracted zero-contours."
        : "Showing glow-based nodal rendering.";
    requestRender();
  });
});

controls.singleModeIndex.addEventListener("input", () => {
  updateModeLabel();
  requestRender();
});

controls.angularRotation.addEventListener("input", () => {
  if (plateShape === "circle") {
    spatialCache.clear();
  }
  requestRender();
});

displayModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    displayMode = button.dataset.mode === "single" ? "single" : "sum";
    displayModeButtons.forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    syncControlVisibility();
    statusNode.textContent =
      displayMode === "single"
        ? "Inspecting one resonance basis at a time."
        : "Showing the combined resonance field.";
    requestRender();
  });
});

combineModeSelect.addEventListener("input", () => {
  combineMode = combineModeSelect.value;
  if (displayMode === "sum") {
    statusNode.textContent =
      combineMode === "signed"
        ? "Showing signed modal interference."
        : combineMode === "residual"
          ? "Showing residual envelope structure."
          : "Showing percentile-based envelope slices.";
  }
  requestRender();
});

singleModeViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    singleModeView = button.dataset.singleView === "oscillation" ? "oscillation" : "amplitude";
    singleModeViewButtons.forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    if (displayMode === "single") {
      statusNode.textContent =
        singleModeView === "oscillation"
          ? "Inspecting one resonance basis with signed oscillation."
          : "Inspecting one resonance basis at a time.";
    }
    requestRender();
  });
});

themeSelect.addEventListener("input", () => {
  if (themeSelect.value === "custom") {
    activeTheme = "custom";
    syncThemeInputs();
    requestRender();
    return;
  }
  applyTheme(themeSelect.value);
  requestRender();
});

[lowColorInput, midColorInput, highColorInput].forEach((input) => {
  input.addEventListener("input", () => {
    lowBandColor = hexToRgb(lowColorInput.value);
    midBandColor = hexToRgb(midColorInput.value);
    highBandColor = hexToRgb(highColorInput.value);
    activeTheme = "custom";
    themeSelect.value = "custom";
    requestRender();
  });
});

audio.addEventListener("play", async () => {
  ensureAudioGraph();
  await audioContext.resume();
  statusNode.textContent = "Running realtime resonance preview.";
  startAnimationLoop();
});

audio.addEventListener("pause", () => {
  statusNode.textContent = "Playback paused. Field is frozen at the current state.";
  stopAnimationLoop();
  requestRender();
});

audio.addEventListener("ended", () => {
  statusNode.textContent = "Playback ended. Field is frozen at the final state.";
  stopAnimationLoop();
  requestRender();
});

window.addEventListener("resize", () => {
  const ratio = window.devicePixelRatio || 1;
  const size = Math.min(canvas.clientWidth || 1280, canvas.clientHeight || 1280);
  canvas.width = Math.max(512, Math.round(size * ratio));
  canvas.height = canvas.width;
  requestRender();
});

window.dispatchEvent(new Event("resize"));
initializeFieldGeometry();
syncThemeInputs();
modeState = buildModes(Math.round(numericControls.modeCount));
controls.singleModeIndex.max = String(Math.round(numericControls.modeCount));
updateModeLabel();
syncControlVisibility();
requestRender();
