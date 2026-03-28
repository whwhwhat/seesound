import type {
  Controls,
  NumericControlId,
  NumericControls,
} from "../types";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element as T;
}

function requireOutput(id: string): HTMLOutputElement {
  const output = document.querySelector<HTMLOutputElement>(`output[for="${id}"]`);
  if (!output) {
    throw new Error(`Missing required output for: ${id}`);
  }
  return output;
}

function requireCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(`Unable to create 2D context for canvas: ${canvas.id || "anonymous"}`);
  }
  return context;
}

function getSegmentedButtons(id: string, selector: string): HTMLButtonElement[] {
  return Array.from(requireElement<HTMLElement>(id).querySelectorAll<HTMLButtonElement>(selector));
}

const canvas = requireElement<HTMLCanvasElement>("preview");
const ctx = requireCanvasContext(canvas);
const wgpuCanvas = requireElement<HTMLCanvasElement>("previewWgpu");
const glCanvas = requireElement<HTMLCanvasElement>("previewGl");
const audio = requireElement<HTMLAudioElement>("audio");
const fileInput = requireElement<HTMLInputElement>("audioFile");
const currentTrackNode = requireElement<HTMLParagraphElement>("currentTrack");
const statusNode = requireElement<HTMLParagraphElement>("status");
const plateShapeButtons = getSegmentedButtons("plateShape", "button[data-shape]");
const angularRotationWrap = requireElement<HTMLElement>("angularRotationWrap");
const renderStyleButtons = getSegmentedButtons("renderStyle", "button[data-render-style]");
const frameRateLimitButtons = getSegmentedButtons("frameRateLimit", "button[data-frame-rate]");
const atmosphereWrap = requireElement<HTMLElement>("atmosphereWrap");
const atmosphereEnabledInput = requireElement<HTMLInputElement>("atmosphereEnabled");
const glowThicknessWrap = requireElement<HTMLElement>("glowThicknessWrap");
const glowSpreadWrap = requireElement<HTMLElement>("glowSpreadWrap");
const glowIntensityWrap = requireElement<HTMLElement>("glowIntensityWrap");
const colorSeparationWrap = requireElement<HTMLElement>("colorSeparationWrap");
const adaptiveColorMixWrap = requireElement<HTMLElement>("adaptiveColorMixWrap");
const themeWrap = requireElement<HTMLElement>("themeWrap");
const lowColorWrap = requireElement<HTMLElement>("lowColorWrap");
const midColorWrap = requireElement<HTMLElement>("midColorWrap");
const highColorWrap = requireElement<HTMLElement>("highColorWrap");
const themeSelect = requireElement<HTMLSelectElement>("themeSelect");
const lowColorInput = requireElement<HTMLInputElement>("lowColor");
const midColorInput = requireElement<HTMLInputElement>("midColor");
const highColorInput = requireElement<HTMLInputElement>("highColor");
const displayModeButtons = getSegmentedButtons("displayMode", "button[data-mode]");
const combineModeWrap = requireElement<HTMLElement>("combineModeWrap");
const combineModeSelect = requireElement<HTMLSelectElement>("combineMode");
const singleModeWrap = requireElement<HTMLElement>("singleModeWrap");
const modeLabel = requireElement<HTMLParagraphElement>("modeLabel");
const bandLabel = requireElement<HTMLParagraphElement>("bandLabel");
const singleModeViewWrap = requireElement<HTMLElement>("singleModeViewWrap");
const singleModeViewButtons = getSegmentedButtons("singleModeView", "button[data-single-view]");
const nodalFocusWrap = requireElement<HTMLElement>("nodalFocusWrap");
const contrastWrap = requireElement<HTMLElement>("contrastWrap");
const singleModeIndexOutput = requireOutput("singleModeIndex");

const controlIds: NumericControlId[] = [
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

const numericControls = {} as NumericControls;
const controls = Object.fromEntries(
  controlIds.map((id) => {
    const input = requireElement<HTMLInputElement>(id);
    const output = requireOutput(id);
    const sync = () => {
      output.value = input.value;
      output.textContent = input.value;
      numericControls[id] = Number.parseFloat(input.value);
    };
    input.addEventListener("input", sync);
    sync();
    return [id, input];
  }),
) as Controls;

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
  currentTrackNode,
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
