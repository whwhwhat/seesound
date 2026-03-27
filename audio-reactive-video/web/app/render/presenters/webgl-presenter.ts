import {
  numericControls,
  state,
} from "../../state/context";
import {
  updateDirectGpuUnderlay,
} from "../../core/geometry";
import {
  readGpuFieldIntoCpuBuffer,
  readGpuGlowAccumulation,
  setGpuCanvasFrame,
  setGpuCanvasPresentation,
  setGpuCanvasVisible,
  shadeFieldOnGpu,
} from "../gpu";
import {
  resolveDisplayScale,
} from "../backends/legacy-backend";
import type {
  FrameContext,
  FrameProfileTools,
  WebGlPresentationState,
} from "../../types";

function presentLegacyWithWebGl(
  frameContext: FrameContext,
  frameProfileTools: FrameProfileTools,
): WebGlPresentationState {
  const {
    backgroundWeight,
    centroid,
    colorAccum,
    colorWeight,
    contrast,
    coreSharpness,
    field,
    glowColor,
    haloSharpness,
    haloWeight,
    isSingleMode,
    lineWeight,
    renderAsDormantField,
    rms,
    separation,
    singleAmpGate,
    singleModeBlur,
    themePalette,
    useGlowColor,
  } = frameContext;

  let hasCpuFieldData = false;
  let hasCpuGlowAccumulation = false;
  let useDirectGpuPresentation = false;
  let displayScale = 1;

  let profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
  const readFieldOk = readGpuFieldIntoCpuBuffer(field);
  frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "gpuReadback", profileStart);
  if (readFieldOk) {
    hasCpuFieldData = true;
    displayScale = resolveDisplayScale(field, isSingleMode);
    updateDirectGpuUnderlay(field, displayScale, {
      plateShape: state.plateShape,
      glowSpread: numericControls.glowSpread,
      contrast,
      haloSharpness,
      backgroundWeight,
      singleAmpGate,
      renderAsDormantField,
      themePalette,
    });
    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    useDirectGpuPresentation = shadeFieldOnGpu({
      rms,
      centroid,
      displayScale: Math.max(1e-6, displayScale),
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
      atmosphereEnabled: false,
      themePalette,
    });
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "gpuShade", profileStart);
    if (useDirectGpuPresentation) {
      const glowBlur = 0.45 + singleModeBlur * 0.6;
      setGpuCanvasFrame(true);
      setGpuCanvasPresentation(true, {
        opacity: 0.14,
        blurPx: glowBlur,
        shadowAlpha: 0.08,
      });
      setGpuCanvasVisible(true, state.plateShape === "circle" && state.combineMode === "signed");
    }
  }

  if (!useDirectGpuPresentation) {
    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    readGpuGlowAccumulation(field, colorWeight, colorAccum);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "gpuReadback", profileStart);
    hasCpuFieldData = true;
    hasCpuGlowAccumulation = true;
  }

  return {
    displayScale,
    hasCpuFieldData,
    hasCpuGlowAccumulation,
    useDirectGpuPresentation,
  };
}

export {
  presentLegacyWithWebGl,
};
