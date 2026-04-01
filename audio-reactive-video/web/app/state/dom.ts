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

const appShell = requireElement<HTMLElement>("appShell");
const controlPanelViewport = requireElement<HTMLElement>("controlPanelViewport");
const controlPanel = requireElement<HTMLElement>("controlPanel");
const canvas = requireElement<HTMLCanvasElement>("preview");
const ctx = requireCanvasContext(canvas);
const wgpuCanvas = requireElement<HTMLCanvasElement>("previewWgpu");
const glCanvas = requireElement<HTMLCanvasElement>("previewGl");
const audio = requireElement<HTMLAudioElement>("audio");
const audioInputModeWrap = requireElement<HTMLElement>("audioInputModeWrap");
const audioInputModeTrigger = requireElement<HTMLButtonElement>("audioInputModeTrigger");
const audioInputModeMenu = requireElement<HTMLElement>("audioInputModeMenu");
const audioInputModeValue = requireElement<HTMLElement>("audioInputModeValue");
const audioInputModeSelect = requireElement<HTMLSelectElement>("audioInputModeSelect");
const audioPlayerCard = requireElement<HTMLElement>("audioPlayerCard");
const audioFilePanel = requireElement<HTMLElement>("audioFilePanel");
const audioCapturePanel = requireElement<HTMLElement>("audioCapturePanel");
const audioMeta = requireElement<HTMLElement>("audioMeta");
const audioPlayPauseButton = requireElement<HTMLButtonElement>("audioPlayPause");
const audioSeekInput = requireElement<HTMLInputElement>("audioSeek");
const audioTimeNode = requireElement<HTMLElement>("audioTime");
const audioVolumeWrap = requireElement<HTMLElement>("audioVolumeWrap");
const audioVolumeToggleButton = requireElement<HTMLButtonElement>("audioVolumeToggle");
const audioVolumeInput = requireElement<HTMLInputElement>("audioVolume");
const fileInput = requireElement<HTMLInputElement>("audioFile");
const audioCaptureToggleButton = requireElement<HTMLButtonElement>("audioCaptureToggle");
const panelCollapseHandle = requireElement<HTMLButtonElement>("panelCollapseHandle");
const panelExpandHandle = requireElement<HTMLButtonElement>("panelExpandHandle");
const currentTrackNode = requireElement<HTMLParagraphElement>("currentTrack");
const heroTitle = requireElement<HTMLHeadingElement>("heroTitle");
const heroLede = requireElement<HTMLParagraphElement>("heroLede");
const playbackKicker = requireElement<HTMLParagraphElement>("playbackKicker");
const statusNode = requireElement<HTMLParagraphElement>("status");
const visualModeWrap = requireElement<HTMLElement>("visualModeWrap");
const visualModeTrigger = requireElement<HTMLButtonElement>("visualModeTrigger");
const visualModeMenu = requireElement<HTMLElement>("visualModeMenu");
const visualModeValue = requireElement<HTMLElement>("visualModeValue");
const visualModeSelect = requireElement<HTMLSelectElement>("visualModeSelect");
const crystalModeNote = requireElement<HTMLParagraphElement>("crystalModeNote");
const latticeModeNote = requireElement<HTMLParagraphElement>("latticeModeNote");
const latticePerspectiveWrap = requireElement<HTMLLabelElement>("latticePerspectiveWrap");
const latticePerspectiveEnabledInput = requireElement<HTMLInputElement>("latticePerspectiveEnabled");
const latticeRotationSpeedWrap = requireElement<HTMLLabelElement>("latticeRotationSpeedWrap");
const latticeRotationSpeedInput = requireElement<HTMLInputElement>("latticeRotationSpeed");
const latticeRotationSpeedOutput = requireOutput("latticeRotationSpeed");
const latticeTranslateXWrap = requireElement<HTMLLabelElement>("latticeTranslateXWrap");
const latticeTranslateYWrap = requireElement<HTMLLabelElement>("latticeTranslateYWrap");
const latticeTranslateZWrap = requireElement<HTMLLabelElement>("latticeTranslateZWrap");
const latticeTranslateWWrap = requireElement<HTMLLabelElement>("latticeTranslateWWrap");
const latticeTranslateXInput = requireElement<HTMLInputElement>("latticeTranslateX");
const latticeTranslateYInput = requireElement<HTMLInputElement>("latticeTranslateY");
const latticeTranslateZInput = requireElement<HTMLInputElement>("latticeTranslateZ");
const latticeTranslateWInput = requireElement<HTMLInputElement>("latticeTranslateW");
const latticeTranslateXOutput = requireOutput("latticeTranslateX");
const latticeTranslateYOutput = requireOutput("latticeTranslateY");
const latticeTranslateZOutput = requireOutput("latticeTranslateZ");
const latticeTranslateWOutput = requireOutput("latticeTranslateW");
const crystalMaterialBlock = requireElement<HTMLElement>("crystalMaterialBlock");
const crystalMaterialButtons = getSegmentedButtons("crystalMaterial", "button[data-crystal-material]");
const crystalPaletteBlock = requireElement<HTMLElement>("crystalPaletteBlock");
const crystalPaletteButtons = getSegmentedButtons("crystalPalette", "button[data-crystal-palette]");
const crystalTonalFocusWrap = requireElement<HTMLLabelElement>("crystalTonalFocusWrap");
const crystalFlowWrap = requireElement<HTMLLabelElement>("crystalFlowWrap");
const crystalTensionWrap = requireElement<HTMLLabelElement>("crystalTensionWrap");
const crystalBloomWrap = requireElement<HTMLLabelElement>("crystalBloomWrap");
const crystalTonalFocusInput = requireElement<HTMLInputElement>("crystalTonalFocus");
const crystalFlowInput = requireElement<HTMLInputElement>("crystalFlow");
const crystalTensionInput = requireElement<HTMLInputElement>("crystalTension");
const crystalBloomInput = requireElement<HTMLInputElement>("crystalBloom");
const crystalTonalFocusOutput = requireOutput("crystalTonalFocus");
const crystalFlowOutput = requireOutput("crystalFlow");
const crystalTensionOutput = requireOutput("crystalTension");
const crystalBloomOutput = requireOutput("crystalBloom");
const plateShapeBlock = requireElement<HTMLElement>("plateShapeBlock");
const renderStyleBlock = requireElement<HTMLElement>("renderStyleBlock");
const fieldBehaviorSection = requireElement<HTMLElement>("fieldBehaviorSection");
const advancedPanel = requireElement<HTMLDetailsElement>("advancedPanel");
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
const themeTrigger = requireElement<HTMLButtonElement>("themeTrigger");
const themeMenu = requireElement<HTMLElement>("themeMenu");
const themeValue = requireElement<HTMLElement>("themeValue");
const lowColorWrap = requireElement<HTMLElement>("lowColorWrap");
const midColorWrap = requireElement<HTMLElement>("midColorWrap");
const highColorWrap = requireElement<HTMLElement>("highColorWrap");
const lowColorButton = requireElement<HTMLButtonElement>("lowColorButton");
const midColorButton = requireElement<HTMLButtonElement>("midColorButton");
const highColorButton = requireElement<HTMLButtonElement>("highColorButton");
const colorPickerPopover = requireElement<HTMLElement>("colorPickerPopover");
const colorPickerSurface = requireElement<HTMLElement>("colorPickerSurface");
const colorPickerHandle = requireElement<HTMLElement>("colorPickerHandle");
const colorPickerHue = requireElement<HTMLInputElement>("colorPickerHue");
const colorPickerHueHandle = requireElement<HTMLElement>("colorPickerHueHandle");
const colorPickerHex = requireElement<HTMLInputElement>("colorPickerHex");
const colorPickerR = requireElement<HTMLInputElement>("colorPickerR");
const colorPickerG = requireElement<HTMLInputElement>("colorPickerG");
const colorPickerB = requireElement<HTMLInputElement>("colorPickerB");
const colorPickerPreview = requireElement<HTMLElement>("colorPickerPreview");
const colorPickerValue = requireElement<HTMLElement>("colorPickerValue");
const themeSelect = requireElement<HTMLSelectElement>("themeSelect");
const lowColorInput = requireElement<HTMLInputElement>("lowColor");
const midColorInput = requireElement<HTMLInputElement>("midColor");
const highColorInput = requireElement<HTMLInputElement>("highColor");
const displayModeButtons = getSegmentedButtons("displayMode", "button[data-mode]");
const combineModeWrap = requireElement<HTMLElement>("combineModeWrap");
const combineModeTrigger = requireElement<HTMLButtonElement>("combineModeTrigger");
const combineModeMenu = requireElement<HTMLElement>("combineModeMenu");
const combineModeValue = requireElement<HTMLElement>("combineModeValue");
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
  appShell,
  advancedPanel,
  angularRotationWrap,
  atmosphereEnabledInput,
  atmosphereWrap,
  audio,
  audioCapturePanel,
  audioPlayPauseButton,
  audioSeekInput,
  audioTimeNode,
  audioVolumeInput,
  audioCaptureToggleButton,
  audioFilePanel,
  audioInputModeMenu,
  audioInputModeSelect,
  audioInputModeTrigger,
  audioInputModeValue,
  audioInputModeWrap,
  audioMeta,
  audioPlayerCard,
  audioVolumeToggleButton,
  audioVolumeWrap,
  bandLabel,
  canvas,
  colorPickerB,
  colorPickerG,
  colorPickerHandle,
  colorPickerHex,
  colorPickerHue,
  colorPickerHueHandle,
  colorPickerPopover,
  colorPickerPreview,
  colorPickerR,
  colorPickerSurface,
  colorPickerValue,
  colorSeparationWrap,
  combineModeSelect,
  combineModeWrap,
  contrastWrap,
  controlPanel,
  controlPanelViewport,
  controls,
  currentTrackNode,
  crystalMaterialBlock,
  crystalMaterialButtons,
  latticeModeNote,
  latticePerspectiveEnabledInput,
  latticePerspectiveWrap,
  latticeRotationSpeedInput,
  latticeRotationSpeedOutput,
  latticeRotationSpeedWrap,
  latticeTranslateWInput,
  latticeTranslateWOutput,
  latticeTranslateWWrap,
  latticeTranslateXInput,
  latticeTranslateXOutput,
  latticeTranslateXWrap,
  latticeTranslateYInput,
  latticeTranslateYOutput,
  latticeTranslateYWrap,
  latticeTranslateZInput,
  latticeTranslateZOutput,
  latticeTranslateZWrap,
  crystalPaletteBlock,
  crystalPaletteButtons,
  ctx,
  crystalBloomInput,
  crystalBloomOutput,
  crystalBloomWrap,
  crystalFlowInput,
  crystalFlowOutput,
  crystalFlowWrap,
  crystalModeNote,
  crystalTensionInput,
  crystalTensionOutput,
  crystalTensionWrap,
  crystalTonalFocusInput,
  crystalTonalFocusOutput,
  crystalTonalFocusWrap,
  displayModeButtons,
  fieldBehaviorSection,
  fileInput,
  frameRateLimitButtons,
  glCanvas,
  glowIntensityWrap,
  glowSpreadWrap,
  glowThicknessWrap,
  highColorButton,
  highColorInput,
  highColorWrap,
  heroLede,
  heroTitle,
  lowColorButton,
  lowColorInput,
  lowColorWrap,
  midColorButton,
  midColorInput,
  midColorWrap,
  modeLabel,
  nodalFocusWrap,
  numericControls,
  panelCollapseHandle,
  panelExpandHandle,
  playbackKicker,
  plateShapeBlock,
  plateShapeButtons,
  renderStyleButtons,
  renderStyleBlock,
  singleModeIndexOutput,
  singleModeViewButtons,
  singleModeViewWrap,
  singleModeWrap,
  statusNode,
  combineModeMenu,
  themeSelect,
  combineModeTrigger,
  combineModeValue,
  themeMenu,
  themeTrigger,
  themeValue,
  themeWrap,
  visualModeMenu,
  visualModeSelect,
  visualModeTrigger,
  visualModeValue,
  visualModeWrap,
  wgpuCanvas,
};
