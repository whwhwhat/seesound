import {
  audio,
  numericControls,
} from "../state/dom";
import {
  contourPathCache,
  fieldImage,
  renderBuffers,
} from "../state/render-resources";
import {
  rendererFlags,
  state,
} from "../state/runtime-state";
import {
  buildModeRenderState,
  getThemeGlowPalette,
} from "../core/runtime";
import {
  ensureSpatialAtlas,
  resetRenderBuffers,
} from "../core/geometry";
import {
  clamp,
  lerpColor,
} from "../core/utils";
import type {
  AudioFrame,
  FrameContext,
  RGBColor,
} from "../types";

function updateModeDynamics(bands: Float32Array, rms: number, centroid: number): void {
  const coupling = numericControls.coupling;
  const persistence = numericControls.persistence;
  const motion = numericControls.motion;

  state.phase += 0.01 + centroid * 0.08 + rms * motion * 0.03;

  for (let index = 0; index < state.modeState.length; index += 1) {
    const mode = state.modeState[index];
    const bandValue = bands[index] || 0;
    const excitation = Math.pow(Math.max(0, bandValue), 1.35) * (0.4 + coupling * 1.3);
    const detune = Math.sin(state.phase * (0.6 + mode.bandBias * 1.8) + mode.phase) * motion * 0.06;
    mode.velocity = mode.velocity * persistence + (excitation - mode.amp) * (0.18 + coupling * 0.1);
    mode.amp = Math.max(0, mode.amp + mode.velocity + detune);
    mode.amp *= 0.985;
  }
}

function buildFrameContext(audioFrame: AudioFrame): FrameContext {
  const {
    bands,
    centroid,
    isPlaying,
    rms,
  } = audioFrame;

  const sampleRate = state.audioContext?.sampleRate ?? state.audioSampleRate ?? 48000;
  const field = renderBuffers.field;
  const colorWeight = renderBuffers.colorWeight;
  const colorAccum = renderBuffers.colorAccum;

  resetRenderBuffers();
  contourPathCache.key = "";
  contourPathCache.path = null;

  const singleModeIndex = Math.max(0, Math.min(state.modeState.length - 1, Math.round(numericControls.singleModeIndex) - 1));
  const isSingleMode = state.displayMode === "single";
  const isSignedMode = isSingleMode || state.combineMode === "signed";
  const useGlowColor = state.renderStyle === "glow";
  const shouldAttemptGpuField = state.renderStyle === "isoline" || state.renderStyle === "glow";
  const prefersLegacyWebGlPresentation =
    rendererFlags.directGpuPresentation &&
    state.renderStyle === "glow" &&
    isSignedMode;
  const renderAsDormantScene = !isPlaying && audio.currentTime <= 0.001;
  const themePalette = getThemeGlowPalette();

  if (isPlaying) {
    updateModeDynamics(bands, rms, centroid);
  }

  const spatialAtlas = ensureSpatialAtlas();
  const modeRenderState = buildModeRenderState(sampleRate, themePalette, singleModeIndex, isSingleMode);

  let activeSingleAmp = 0;
  let sceneColorWeight = 0;
  const sceneColorAccum: RGBColor = [0, 0, 0];

  for (let index = 0; index < state.modeState.length; index += 1) {
    if (modeRenderState.enabled[index] === 0) {
      continue;
    }
    const modeContribution = modeRenderState.contribution[index];
    const modeMagnitude = Math.abs(modeContribution);
    activeSingleAmp = Math.max(activeSingleAmp, modeMagnitude);
    if (useGlowColor) {
      sceneColorWeight += modeMagnitude;
      sceneColorAccum[0] += modeRenderState.color[index * 3] * modeMagnitude;
      sceneColorAccum[1] += modeRenderState.color[index * 3 + 1] * modeMagnitude;
      sceneColorAccum[2] += modeRenderState.color[index * 3 + 2] * modeMagnitude;
    }
  }

  const singleAmpGate = isSingleMode ? Math.min(1, activeSingleAmp * 1.6) : 1;
  const singleAmpFloor = isSingleMode ? 0.0015 : 0;
  const renderAsDormantSingle = isSingleMode && activeSingleAmp < singleAmpFloor;
  const renderAsDormantField = renderAsDormantScene || renderAsDormantSingle;
  const singleFocus = isSingleMode ? Math.max(0, Math.min(1, singleAmpGate)) : 1;
  const nodalFocus = numericControls.nodalFocus;
  const contrast = numericControls.contrast;
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
  const averageGlowColor: RGBColor =
    sceneColorWeight > 1e-6
      ? [
        sceneColorAccum[0] / sceneColorWeight,
        sceneColorAccum[1] / sceneColorWeight,
        sceneColorAccum[2] / sceneColorWeight,
      ]
      : themePalette.baseColor;
  const separation = numericControls.colorSeparation;
  const glowColor = lerpColor(themePalette.baseColor, averageGlowColor, clamp(0.78 + separation * 0.14, 0, 1));

  return {
    audioFrame,
    colorAccum,
    colorWeight,
    combineMode: state.combineMode,
    contrast,
    coreSharpness,
    displayMode: state.displayMode,
    field,
    fieldImageData: fieldImage.data,
    haloSharpness,
    haloWeight,
    isSignedMode,
    isSingleMode,
    lineWeight,
    modeRenderState,
    prefersLegacyWebGlPresentation,
    renderStyle: state.renderStyle,
    renderAsDormantField,
    rms,
    separation,
    shouldAttemptGpuField,
    singleAmpGate,
    singleModeBlur,
    spatialAtlas,
    themePalette,
    useGlowColor,
    backgroundWeight,
    centroid,
    glowColor,
  };
}

export {
  buildFrameContext,
};
