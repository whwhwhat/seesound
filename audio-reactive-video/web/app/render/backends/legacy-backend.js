import {
  state,
} from "../../state/context.js";
import {
  getSpatialMode,
  percentileOfField,
  removeRadialAverage,
} from "../../core/geometry.js";
import {
  readGpuFieldIntoCpuBuffer,
  readGpuGlowAccumulation,
  runGpuFieldAccumulation,
  shouldValidateGpuField,
  validateGpuFieldAgainstCpu,
} from "../gpu.js";

function accumulateFieldOnCpu(frameContext) {
  const {
    colorAccum,
    colorWeight,
    field,
    modeRenderState,
    useGlowColor,
  } = frameContext;

  for (let index = 0; index < state.modeState.length; index += 1) {
    const mode = state.modeState[index];
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
        state.displayMode === "single" || state.combineMode === "signed"
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

function resolveDisplayScale(field, isSingleMode) {
  let maxAbs = 1e-6;
  for (let ptr = 0; ptr < field.length; ptr += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(field[ptr]));
  }
  return isSingleMode ? 1 : maxAbs;
}

function accumulateLegacyField(frameContext, renderPlan, frameProfileTools) {
  const {
    colorAccum,
    colorWeight,
    field,
    isSingleMode,
    modeRenderState,
    spatialAtlas,
    useGlowColor,
  } = frameContext;

  let profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
  const didAccumulateOnGpu = renderPlan.shouldAttemptGpuField
    ? runGpuFieldAccumulation(spatialAtlas, modeRenderState, isSingleMode, useGlowColor)
    : false;
  frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "gpuAccumulate", profileStart);

  let hasCpuFieldData = false;
  let hasCpuGlowAccumulation = false;

  if (didAccumulateOnGpu && renderPlan.legacyPresenter !== "webgl") {
    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    if (useGlowColor) {
      readGpuGlowAccumulation(field, colorWeight, colorAccum);
      hasCpuGlowAccumulation = true;
    } else {
      readGpuFieldIntoCpuBuffer(field);
    }
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "gpuReadback", profileStart);
    hasCpuFieldData = true;
  } else if (!didAccumulateOnGpu) {
    profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
    accumulateFieldOnCpu(frameContext);
    frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "cpuAccumulate", profileStart);
    hasCpuFieldData = true;
    hasCpuGlowAccumulation = useGlowColor;
  }

  if (!didAccumulateOnGpu && shouldValidateGpuField()) {
    validateGpuFieldAgainstCpu(field);
  }

  return {
    didAccumulateOnGpu,
    hasCpuFieldData,
    hasCpuGlowAccumulation,
  };
}

function postprocessLegacyField(frameContext, hasCpuFieldData, frameProfileTools) {
  if (!hasCpuFieldData) {
    return;
  }

  const {
    field,
  } = frameContext;

  const profileStart = frameProfileTools.profileSectionStart(frameProfileTools.frameProfile);
  if (state.displayMode !== "single" && state.combineMode !== "signed") {
    if (state.combineMode === "residual") {
      if (state.plateShape === "circle") {
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
    } else if (state.combineMode === "percentile") {
      const threshold = percentileOfField(
        field,
        state.plateShape === "circle" ? 0.74 : 0.7,
        state.plateShape === "circle",
      );
      for (let ptr = 0; ptr < field.length; ptr += 1) {
        field[ptr] -= threshold;
      }
    }
  }
  frameProfileTools.profileSectionEnd(frameProfileTools.frameProfile, "fieldPost", profileStart);
}

export {
  accumulateLegacyField,
  postprocessLegacyField,
  resolveDisplayScale,
};
