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
const glowIntensityWrap = document.getElementById("glowIntensityWrap");
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
  "glowIntensity",
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

export {
  adaptiveColorMixWrap,
  angularRotationWrap,
  atmosphereEnabledInput,
  atmosphereWrap,
  audio,
  bandLabel,
  canvas,
  colorSeparationWrap,
  combineModeSelect,
  combineModeWrap,
  contrastWrap,
  controls,
  ctx,
  displayModeButtons,
  fileInput,
  frameRateLimitButtons,
  glCanvas,
  glowIntensityWrap,
  glowSpreadWrap,
  glowThicknessWrap,
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
  renderStyleButtons,
  singleModeIndexOutput,
  singleModeViewButtons,
  singleModeViewWrap,
  singleModeWrap,
  statusNode,
  themeSelect,
  themeWrap,
  wgpuCanvas,
};
