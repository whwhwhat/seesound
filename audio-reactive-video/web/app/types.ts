export type RGBColor = [number, number, number];

export type NumericControlId =
  | "glowThickness"
  | "glowSpread"
  | "glowIntensity"
  | "colorSeparation"
  | "adaptiveColorMix"
  | "angularRotation"
  | "singleModeIndex"
  | "modeCount"
  | "coupling"
  | "persistence"
  | "nodalFocus"
  | "contrast"
  | "motion";

export type RenderStyle = "glow" | "isoline";
export type DisplayMode = "sum" | "single";
export type CombineMode = "signed" | "residual" | "percentile";
export type SingleModeView = "amplitude" | "oscillation";
export type FrameRateLimit = "auto" | "60";
export type PlateShape = "square" | "circle";
export type VisualMode = "spectral" | "crystal" | "lattice";
export type CrystalMaterial = "prism" | "opal" | "basalt";
export type CrystalPalette = "glacial" | "verdigris" | "ember";
export type ThemeKey =
  | "lab"
  | "amber"
  | "ice"
  | "heat"
  | "mono"
  | "aurora"
  | "sunset"
  | "neon"
  | "ocean";
export type ActiveTheme = ThemeKey | "custom";
export type ActiveRenderer = "legacy" | "webgpu";
export type ActivePresentation = "cpu" | "webgl" | "native";

export interface ModeState {
  m: number;
  n: number;
  phase: number;
  bandBias: number;
  amp: number;
  velocity: number;
}

export interface ThemePreset {
  low: RGBColor;
  mid: RGBColor;
  high: RGBColor;
}

export interface ThemeGlowPalette {
  lineColor: RGBColor;
  baseColor: RGBColor;
  outerColor: RGBColor;
  backdropColor: RGBColor;
  atmosphereCore: RGBColor;
  atmosphereOuter: RGBColor;
}

export interface AudioFrame {
  bands: Float32Array;
  rms: number;
  centroid: number;
  isPlaying: boolean;
}

export interface ModeRenderState {
  contribution: Float32Array;
  sharpMix: Float32Array;
  blurMix: Float32Array;
  enabled: Uint8Array;
  color: Float32Array;
}

export interface SpatialModeBundle {
  sharp: Float32Array;
  blurred: Float32Array;
}

export interface SpatialAtlasCache {
  key: string;
  sharp: Float32Array;
  blurred: Float32Array;
  modeCount: number;
}

export interface AppState {
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  sourceNode: MediaElementAudioSourceNode | null;
  freqData: Uint8Array | null;
  timeData: Uint8Array | null;
  modeState: ModeState[];
  bandProfile: Float32Array;
  animationFrame: number;
  isAnimating: boolean;
  lastAnimationTimestamp: number;
  phase: number;
  renderStyle: RenderStyle;
  displayMode: DisplayMode;
  combineMode: CombineMode;
  singleModeView: SingleModeView;
  frameRateLimit: FrameRateLimit;
  plateShape: PlateShape;
  visualMode: VisualMode;
  crystalMaterial: CrystalMaterial;
  crystalPalette: CrystalPalette;
  crystalPitchProfile: Float32Array;
  crystalTonalFocus: number;
  crystalFlow: number;
  crystalTension: number;
  crystalBloom: number;
  latticePerspectiveEnabled: boolean;
  latticeRotationSpeed: number;
  latticeTranslateX: number;
  latticeTranslateY: number;
  latticeTranslateZ: number;
  latticeTranslateW: number;
  activeTheme: ActiveTheme;
  lowBandColor: RGBColor;
  midBandColor: RGBColor;
  highBandColor: RGBColor;
  currentAudioObjectUrl: string | null;
  currentAudioFileName: string | null;
  activeRenderer: ActiveRenderer;
  activePresentation: ActivePresentation;
}

export interface RendererFlags {
  directGpuPresentation: boolean;
}

export interface ProfilerState {
  enabled: boolean;
  overlay: HTMLPreElement | null;
  frameCount: number;
  fps: number;
  lastFrameTimestamp: number;
  samples: Record<string, number>;
  order: string[];
}

export interface FrameProfile {
  start: number;
  sections: Record<string, number>;
}

export type NumericControls = Record<NumericControlId, number>;
export type Controls = Record<NumericControlId, HTMLInputElement>;

export interface RenderBuffers {
  field: Float32Array;
  colorWeight: Float32Array;
  colorAccum: Float32Array;
  inactiveBands: Float32Array;
  modeContribution: Float32Array;
  modeSharpMix: Float32Array;
  modeBlurMix: Float32Array;
  modeEnabled: Uint8Array;
  modeColor: Float32Array;
  gpuFieldReadback: Float32Array;
}

export interface FieldGeometry {
  nx: Float32Array;
  ny: Float32Array;
  modeRadius: Float32Array;
  circleInteriorMask: Uint8Array;
  squareMask: Float32Array;
  circleMask: Float32Array;
  dither: Float32Array;
}

export interface BandRange {
  start: number;
  end: number;
  lowHz: number;
  highHz: number;
}

export interface FrameContext {
  audioFrame: AudioFrame;
  colorAccum: Float32Array;
  colorWeight: Float32Array;
  combineMode: CombineMode;
  contrast: number;
  coreSharpness: number;
  displayMode: DisplayMode;
  field: Float32Array;
  fieldImageData: Uint8ClampedArray;
  haloSharpness: number;
  haloWeight: number;
  isSignedMode: boolean;
  isSingleMode: boolean;
  lineWeight: number;
  modeRenderState: ModeRenderState;
  prefersLegacyWebGlPresentation: boolean;
  renderStyle: RenderStyle;
  renderAsDormantField: boolean;
  rms: number;
  separation: number;
  shouldAttemptGpuField: boolean;
  singleAmpGate: number;
  singleModeBlur: number;
  spatialAtlas: SpatialAtlasCache;
  themePalette: ThemeGlowPalette;
  useGlowColor: boolean;
  backgroundWeight: number;
  centroid: number;
  glowColor: RGBColor;
}

export interface RenderPlan {
  backend: ActiveRenderer;
  capabilityKey: string;
  legacyPresenter: Exclude<ActivePresentation, "native">;
  shouldAttemptGpuField: boolean;
}

export interface FrameProfileTools {
  frameProfile: FrameProfile | null;
  profileSectionStart(frameProfile: FrameProfile | null): number;
  profileSectionEnd(frameProfile: FrameProfile | null, name: string, startTime: number): void;
}

export interface DirectGpuUnderlayParams {
  plateShape: PlateShape;
  glowSpread: number;
  contrast: number;
  haloSharpness: number;
  backgroundWeight: number;
  singleAmpGate: number;
  renderAsDormantField: boolean;
  themePalette: ThemeGlowPalette;
}

export interface CpuPresenterState {
  displayScale: number;
  hasCpuGlowAccumulation: boolean;
  useDirectGpuPresentation: boolean;
}

export interface CompositeRenderState {
  displayScale: number;
  hasCpuFieldData: boolean;
  useDirectGpuPresentation: boolean;
}

export interface DrawHelpers {
  drawAtmosphereOverlay(themePalette: ThemeGlowPalette): void;
  drawGlowContours(path: Path2D, drawSize: number, ampGate: number, glowColor: RGBColor, themePalette: ThemeGlowPalette): void;
  drawIsolines(path: Path2D, ampGate: number, drawSize: number): void;
  getIsolinePath(field: Float32Array, displayScale: number, inset: number, drawSize: number, smoothed?: boolean): Path2D;
}

export interface WebGlPresentationState extends CompositeRenderState {
  hasCpuGlowAccumulation: boolean;
}

export interface GpuFieldPipelineAttribs {
  position: number;
}

export interface GpuFieldPipelineUniforms {
  sharpAtlas: WebGLUniformLocation | null;
  blurredAtlas: WebGLUniformLocation | null;
  modeState: WebGLUniformLocation | null;
  modeCount: WebGLUniformLocation | null;
  singleMode: WebGLUniformLocation | null;
  signedMode: WebGLUniformLocation | null;
  useGlowColor: WebGLUniformLocation | null;
}

export interface GpuShadePipelineUniforms {
  fieldTex: WebGLUniformLocation | null;
  colorAccumTex: WebGLUniformLocation | null;
  colorWeightTex: WebGLUniformLocation | null;
  ditherTex: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
  displayScale: WebGLUniformLocation | null;
  rms: WebGLUniformLocation | null;
  centroid: WebGLUniformLocation | null;
  contrast: WebGLUniformLocation | null;
  coreSharpness: WebGLUniformLocation | null;
  haloSharpness: WebGLUniformLocation | null;
  lineWeight: WebGLUniformLocation | null;
  haloWeight: WebGLUniformLocation | null;
  backgroundWeight: WebGLUniformLocation | null;
  singleAmpGate: WebGLUniformLocation | null;
  separation: WebGLUniformLocation | null;
  renderDormant: WebGLUniformLocation | null;
  shapeMode: WebGLUniformLocation | null;
  useGlowColor: WebGLUniformLocation | null;
  glowThickness: WebGLUniformLocation | null;
  glowSpread: WebGLUniformLocation | null;
  atmosphereEnabled: WebGLUniformLocation | null;
  baseBgColor: WebGLUniformLocation | null;
  backdropColor: WebGLUniformLocation | null;
  baseColor: WebGLUniformLocation | null;
  lineColor: WebGLUniformLocation | null;
  outerColor: WebGLUniformLocation | null;
  glowColor: WebGLUniformLocation | null;
  atmosphereCore: WebGLUniformLocation | null;
  atmosphereOuter: WebGLUniformLocation | null;
}

export interface GpuFieldPipelineState {
  gl: WebGL2RenderingContext | null;
  available: boolean;
  program: WebGLProgram | null;
  positionBuffer: WebGLBuffer | null;
  framebuffer: WebGLFramebuffer | null;
  outputTexture: WebGLTexture | null;
  colorAccumTexture: WebGLTexture | null;
  colorWeightTexture: WebGLTexture | null;
  sharpAtlasTexture: WebGLTexture | null;
  blurredAtlasTexture: WebGLTexture | null;
  modeStateTexture: WebGLTexture | null;
  attribs: GpuFieldPipelineAttribs | null;
  uniforms: GpuFieldPipelineUniforms | null;
  uploadedSpatialKey: string;
  outputInternalFormat: number;
  outputType: number;
}

export interface GpuShadePipelineState {
  program: WebGLProgram | null;
  positionBuffer: WebGLBuffer | null;
  ditherTexture: WebGLTexture | null;
  attribs: GpuFieldPipelineAttribs | null;
  uniforms: GpuShadePipelineUniforms | null;
  uploadedDither: boolean;
  available: boolean;
}

export interface GpuFieldValidationState {
  frame: number;
  lastComparedFrame: number;
  maxAbsDiff: number;
  meanAbsDiff: number;
}

export interface GpuShadeParams {
  displayScale: number;
  rms: number;
  centroid: number;
  contrast: number;
  coreSharpness: number;
  haloSharpness: number;
  lineWeight: number;
  haloWeight: number;
  backgroundWeight: number;
  singleAmpGate: number;
  separation: number;
  renderAsDormantSingle: boolean;
  useGlowColor: boolean;
  glowThickness: number;
  glowSpread: number;
  glowColor: RGBColor;
  atmosphereEnabled: boolean;
  themePalette: ThemeGlowPalette;
}

export interface InitializedGpuFieldPipeline extends GpuFieldPipelineState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  framebuffer: WebGLFramebuffer;
  outputTexture: WebGLTexture;
  colorAccumTexture: WebGLTexture;
  colorWeightTexture: WebGLTexture;
  sharpAtlasTexture: WebGLTexture;
  blurredAtlasTexture: WebGLTexture;
  modeStateTexture: WebGLTexture;
  attribs: GpuFieldPipelineAttribs;
  uniforms: GpuFieldPipelineUniforms;
}

export interface InitializedGpuShadePipeline extends GpuShadePipelineState {
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  ditherTexture: WebGLTexture;
  attribs: GpuFieldPipelineAttribs;
  uniforms: GpuShadePipelineUniforms;
}

export interface WebGpuReductionTarget {
  width: number;
  height: number;
  texture: GPUTexture;
  view: GPUTextureView;
}

export interface WebGpuRenderParams {
  rms: number;
  centroid: number;
  contrast: number;
  coreSharpness: number;
  haloSharpness: number;
  lineWeight: number;
  haloWeight: number;
  backgroundWeight: number;
  singleAmpGate: number;
  separation: number;
  renderAsDormantField: boolean;
  useGlowColor: boolean;
  themePalette: ThemeGlowPalette;
  glowColor: RGBColor;
  isSingleMode: boolean;
}

export interface WebGpuFrameProfileTools {
  frameProfile: FrameProfile | null;
  profileSectionStart(frameProfile: FrameProfile | null): number;
  profileSectionEnd(frameProfile: FrameProfile | null, name: string, startTime: number): void;
}

export interface WebGpuState {
  adapter: GPUAdapter | null;
  device: GPUDevice | null;
  context: GPUCanvasContext | null;
  canvasFormat: string;
  ready: boolean;
  failed: boolean;
  initPromise: Promise<boolean> | null;
  currentCanvasSize: string;
  uploadedAtlasKey: string;
  fieldPipeline: GPURenderPipeline | null;
  reducePipeline: GPURenderPipeline | null;
  residualAccumulatePipeline: GPUComputePipeline | null;
  residualResolvePipeline: GPUComputePipeline | null;
  residualApplyPipeline: GPUComputePipeline | null;
  percentileMaxPipeline: GPUComputePipeline | null;
  percentileHistogramPipeline: GPUComputePipeline | null;
  percentileResolvePipeline: GPUComputePipeline | null;
  backgroundPipeline: GPURenderPipeline | null;
  contourPipeline: GPUComputePipeline | null;
  linePipeline: GPURenderPipeline | null;
  lineUnionPipeline: GPURenderPipeline | null;
  blurPipeline: GPURenderPipeline | null;
  sharpAtlasTexture: GPUTexture | null;
  blurredAtlasTexture: GPUTexture | null;
  ditherTexture: GPUTexture | null;
  fieldTexture: GPUTexture | null;
  fieldView: GPUTextureView | null;
  residualFieldTexture: GPUTexture | null;
  residualFieldView: GPUTextureView | null;
  colorAccumTexture: GPUTexture | null;
  colorAccumView: GPUTextureView | null;
  colorWeightTexture: GPUTexture | null;
  colorWeightView: GPUTextureView | null;
  reductionChain: WebGpuReductionTarget[];
  modeStateBuffer: GPUBuffer | null;
  fieldParamsBuffer: GPUBuffer | null;
  reduceParamsBuffer: GPUBuffer | null;
  residualParamsBuffer: GPUBuffer | null;
  residualStatsBuffer: GPUBuffer | null;
  residualAverageBuffer: GPUBuffer | null;
  percentileParamsBuffer: GPUBuffer | null;
  percentileHistogramBuffer: GPUBuffer | null;
  percentileResultBuffer: GPUBuffer | null;
  percentileMaxFieldBuffer: GPUBuffer | null;
  percentileDebugBuffer: GPUBuffer | null;
  percentileDebugPending: boolean;
  percentileDebugFrame: number;
  backgroundParamsBuffer: GPUBuffer | null;
  contourParamsBuffer: GPUBuffer | null;
  lineParamsBuffers: GPUBuffer[];
  blurParamsBuffers: GPUBuffer[];
  segmentBuffer: GPUBuffer | null;
  glowSourceTexture: GPUTexture | null;
  glowSourceView: GPUTextureView | null;
  glowBlurTexture: GPUTexture | null;
  glowBlurView: GPUTextureView | null;
  glowTargetWidth: number;
  glowTargetHeight: number;
  linearSampler: GPUSampler | null;
  dirtyContextConfig: boolean;
}

export interface InitializedWebGpuState extends WebGpuState {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  fieldPipeline: GPURenderPipeline;
  reducePipeline: GPURenderPipeline;
  residualAccumulatePipeline: GPUComputePipeline;
  residualResolvePipeline: GPUComputePipeline;
  residualApplyPipeline: GPUComputePipeline;
  percentileMaxPipeline: GPUComputePipeline;
  percentileHistogramPipeline: GPUComputePipeline;
  percentileResolvePipeline: GPUComputePipeline;
  backgroundPipeline: GPURenderPipeline;
  contourPipeline: GPUComputePipeline;
  linePipeline: GPURenderPipeline;
  lineUnionPipeline: GPURenderPipeline;
  blurPipeline: GPURenderPipeline;
  sharpAtlasTexture: GPUTexture;
  blurredAtlasTexture: GPUTexture;
  ditherTexture: GPUTexture;
  fieldTexture: GPUTexture;
  fieldView: GPUTextureView;
  residualFieldTexture: GPUTexture;
  residualFieldView: GPUTextureView;
  colorAccumTexture: GPUTexture;
  colorAccumView: GPUTextureView;
  colorWeightTexture: GPUTexture;
  colorWeightView: GPUTextureView;
  modeStateBuffer: GPUBuffer;
  fieldParamsBuffer: GPUBuffer;
  reduceParamsBuffer: GPUBuffer;
  residualParamsBuffer: GPUBuffer;
  residualStatsBuffer: GPUBuffer;
  residualAverageBuffer: GPUBuffer;
  percentileParamsBuffer: GPUBuffer;
  percentileHistogramBuffer: GPUBuffer;
  percentileResultBuffer: GPUBuffer;
  percentileMaxFieldBuffer: GPUBuffer;
  percentileDebugBuffer: GPUBuffer;
  backgroundParamsBuffer: GPUBuffer;
  contourParamsBuffer: GPUBuffer;
  segmentBuffer: GPUBuffer;
  glowSourceTexture: GPUTexture;
  glowSourceView: GPUTextureView;
  glowBlurTexture: GPUTexture;
  glowBlurView: GPUTextureView;
  linearSampler: GPUSampler;
}
